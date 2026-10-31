// Kirsche Club - serwer biletow QR (C++17)
// Weryfikacja kodu = HMAC-SHA256 + lookup w unordered_map => O(1), mikrosekundy.
// Cel: 250 skanow/h (to ~1 skan na 14 s), serwer wytrzyma tysiace na sekunde.
#include <httplib.h>
#include <nlohmann/json.hpp>
#include <openssl/crypto.h>
#include <openssl/evp.h>
#include <openssl/hmac.h>
#include <openssl/rand.h>
#include <algorithm>
#include <chrono>
#include <cstdlib>
#include <deque>
#include <fstream>
#include <iostream>
#include <mutex>
#include <unordered_map>

using json = nlohmann::json;

static const char* LOG_FILE = "tickets.log";       // append-only: sprzedaz + wejscia
static const char* CONTENT_FILE = "content.json";  // tresci strony edytowane z panelu

struct Ticket {
  std::string id, tier, name, email;
  bool used = false;
  long long created = 0, usedAt = 0;
};

static std::mutex mu;
static std::unordered_map<std::string, Ticket> tickets;
static std::unordered_map<std::string, int> sold;
static std::deque<long long> scans;  // znaczniki czasu udanych wejsc
static json content;
static std::ofstream logOut;
static std::string SECRET, ADMIN_TOKEN, STAFF_TOKEN;
static const int SCAN_TARGET_PER_HOUR = 250;

static long long nowSec() {
  return std::chrono::duration_cast<std::chrono::seconds>(
             std::chrono::system_clock::now().time_since_epoch()).count();
}

static std::string toHex(const unsigned char* d, size_t n) {
  static const char* h = "0123456789abcdef";
  std::string s;
  for (size_t i = 0; i < n; i++) { s += h[d[i] >> 4]; s += h[d[i] & 15]; }
  return s;
}

static std::string sign(const std::string& id) {
  unsigned char out[EVP_MAX_MD_SIZE];
  unsigned len = 0;
  HMAC(EVP_sha256(), SECRET.data(), (int)SECRET.size(),
       (const unsigned char*)id.data(), id.size(), out, &len);
  return toHex(out, 8);  // 16 znakow hex - krotki kod = latwy do zeskanowania
}

static std::string makeCode(const std::string& id) { return "KC1." + id + "." + sign(id); }

static std::string randomId() {
  unsigned char b[10];
  RAND_bytes(b, sizeof b);
  return toHex(b, sizeof b);
}

static void logLine(const json& j) {
  logOut << j.dump() << "\n";
  logOut.flush();
}

static json defaultContent() {
  return json::parse(R"({
    "brand": "KIRSCHE CLUB",
    "heroTitle": "KIRSCHE CLUB",
    "heroSubtitle": "Jedna noc. Zero kompromisów.",
    "eventDate": "2026-12-12T23:00",
    "locationNote": "Lokalizację wyślemy mailem po zakupie biletu.",
    "secretLocation": "Adres zostanie uzupełniony w panelu admina",
    "aboutTitle": "O wydarzeniu",
    "aboutText": "Underground. Ciężki dźwięk, ciemne wnętrze, ograniczona liczba wejść.",
    "ticketsTitle": "Bilety",
    "buyButton": "Kup bilet",
    "footer": "Kirsche Club. Wstęp od 18 lat.",
    "tiers": [
      {"id":"standard","name":"Standard","price":80,"capacity":500,"desc":"Wejście na wydarzenie."},
      {"id":"vip","name":"VIP","price":200,"capacity":100,"desc":"Szybkie wejście i strefa VIP."}
    ]
  })");
}

static void saveContent() {
  std::ofstream f(CONTENT_FILE, std::ios::trunc);
  f << content.dump(2);
}

static void loadState() {
  std::ifstream c(CONTENT_FILE);
  if (c) { try { content = json::parse(c); } catch (...) { content = defaultContent(); } }
  else { content = defaultContent(); saveContent(); }

  std::ifstream f(LOG_FILE);
  std::string line;
  while (std::getline(f, line)) {
    try {
      json j = json::parse(line);
      if (j["t"] == "ticket") {
        Ticket t;
        t.id = j["id"].get<std::string>();
        t.tier = j["tier"].get<std::string>();
        t.name = j["name"].get<std::string>();
        t.email = j["email"].get<std::string>();
        t.created = j["at"].get<long long>();
        sold[t.tier]++;
        tickets[t.id] = t;
      } else if (j["t"] == "used") {
        auto it = tickets.find(j["id"].get<std::string>());
        if (it != tickets.end()) {
          it->second.used = true;
          it->second.usedAt = j["at"].get<long long>();
          scans.push_back(it->second.usedAt);
        }
      }
    } catch (...) {}
  }
}

static bool authed(const httplib::Request& r, const std::string& tok) {
  auto h = r.get_header_value("X-Token");
  return h.size() == tok.size() && CRYPTO_memcmp(h.data(), tok.data(), tok.size()) == 0;
}

static void reply(httplib::Response& res, int status, const json& j) {
  res.status = status;
  res.set_content(j.dump(), "application/json");
}

static std::string env(const char* k, const char* def) {
  const char* v = std::getenv(k);
  return v ? v : def;
}

int main() {
  SECRET = env("KC_SECRET", "zmien-mnie-w-produkcji");
  ADMIN_TOKEN = env("KC_ADMIN_TOKEN", "admin123");
  STAFF_TOKEN = env("KC_STAFF_TOKEN", "bramka123");
  if (SECRET == "zmien-mnie-w-produkcji")
    std::cerr << "UWAGA: ustaw KC_SECRET, KC_ADMIN_TOKEN i KC_STAFF_TOKEN przed startem sprzedazy!\n";

  loadState();
  logOut.open(LOG_FILE, std::ios::app);

  httplib::Server svr;
  svr.new_task_queue = [] { return new httplib::ThreadPool(8); };

  // --- tresci strony (publiczne, bez adresu) ---
  svr.Get("/api/content", [](const httplib::Request&, httplib::Response& res) {
    std::lock_guard<std::mutex> lk(mu);
    json out = content;
    out.erase("secretLocation");
    for (auto& t : out["tiers"]) {
      int s = sold.count(t["id"].get<std::string>()) ? sold[t["id"].get<std::string>()] : 0;
      t["left"] = std::max(0, t["capacity"].get<int>() - s);
    }
    reply(res, 200, out);
  });

  // --- pelne tresci dla admina ---
  svr.Get("/api/admin/content", [](const httplib::Request& req, httplib::Response& res) {
    if (!authed(req, ADMIN_TOKEN)) return reply(res, 401, {{"error", "Zły token"}});
    std::lock_guard<std::mutex> lk(mu);
    reply(res, 200, content);
  });

  svr.Put("/api/admin/content", [](const httplib::Request& req, httplib::Response& res) {
    if (!authed(req, ADMIN_TOKEN)) return reply(res, 401, {{"error", "Zły token"}});
    try {
      json j = json::parse(req.body);
      if (!j.contains("tiers") || !j["tiers"].is_array()) throw std::runtime_error("tiers");
      std::lock_guard<std::mutex> lk(mu);
      content = j;
      saveContent();
      reply(res, 200, {{"ok", true}});
    } catch (...) {
      reply(res, 400, {{"error", "Nieprawidłowe dane"}});
    }
  });

  // --- zakup biletow (platnosc: podlacz Stripe / Przelewy24 / BLIK w tym miejscu) ---
  svr.Post("/api/orders", [](const httplib::Request& req, httplib::Response& res) {
    try {
      json b = json::parse(req.body);
      std::string name = b.at("name").get<std::string>();
      std::string email = b.at("email").get<std::string>();
      std::string tierId = b.at("tier").get<std::string>();
      int qty = b.at("qty").get<int>();
      if (name.empty() || email.find('@') == std::string::npos || qty < 1 || qty > 6)
        return reply(res, 400, {{"error", "Sprawdź imię, e-mail i liczbę biletów (1-6)"}});

      std::lock_guard<std::mutex> lk(mu);
      const json* tier = nullptr;
      for (auto& t : content["tiers"]) if (t["id"].get<std::string>() == tierId) tier = &t;
      if (!tier) return reply(res, 400, {{"error", "Nie ma takiego biletu"}});
      if (sold[tierId] + qty > (*tier)["capacity"].get<int>())
        return reply(res, 409, {{"error", "Brak wystarczającej liczby biletów"}});

      json out = json::array();
      for (int i = 0; i < qty; i++) {
        Ticket t;
        t.id = randomId(); t.tier = tierId; t.name = name; t.email = email; t.created = nowSec();
        tickets[t.id] = t;
        sold[tierId]++;
        logLine({{"t", "ticket"}, {"id", t.id}, {"tier", tierId}, {"name", name},
                 {"email", email}, {"at", t.created}});
        out.push_back({{"id", t.id}, {"code", makeCode(t.id)}, {"tier", (*tier)["name"]}});
      }
      reply(res, 200, {{"tickets", out}, {"location", content.value("secretLocation", "")}});
    } catch (...) {
      reply(res, 400, {{"error", "Nieprawidłowe zamówienie"}});
    }
  });

  // --- weryfikacja QR na bramce ---
  svr.Post("/api/verify", [](const httplib::Request& req, httplib::Response& res) {
    if (!authed(req, STAFF_TOKEN)) return reply(res, 401, {{"error", "Zły token"}});
    std::string code;
    try { code = json::parse(req.body).at("code").get<std::string>(); }
    catch (...) { return reply(res, 400, {{"status", "invalid"}}); }

    // format: KC1.<id>.<sig>
    size_t dot = code.rfind('.');
    if (code.compare(0, 4, "KC1.") != 0 || dot == std::string::npos || dot <= 4)
      return reply(res, 200, {{"status", "invalid"}});
    std::string id = code.substr(4, dot - 4), sig = code.substr(dot + 1);
    std::string expect = sign(id);
    if (sig.size() != expect.size() ||
        CRYPTO_memcmp(sig.data(), expect.data(), sig.size()) != 0)
      return reply(res, 200, {{"status", "invalid"}});

    std::lock_guard<std::mutex> lk(mu);
    auto it = tickets.find(id);
    if (it == tickets.end()) return reply(res, 200, {{"status", "invalid"}});
    Ticket& t = it->second;
    if (t.used)
      return reply(res, 200, {{"status", "used"}, {"name", t.name}, {"usedAt", t.usedAt}});
    t.used = true;
    t.usedAt = nowSec();
    scans.push_back(t.usedAt);
    logLine({{"t", "used"}, {"id", id}, {"at", t.usedAt}});
    reply(res, 200, {{"status", "ok"}, {"name", t.name}, {"tier", t.tier}});
  });

  // --- statystyki dla bramki ---
  svr.Get("/api/stats", [](const httplib::Request& req, httplib::Response& res) {
    if (!authed(req, STAFF_TOKEN)) return reply(res, 401, {{"error", "Zły token"}});
    std::lock_guard<std::mutex> lk(mu);
    long long cutoff = nowSec() - 3600;
    while (!scans.empty() && scans.front() < cutoff) scans.pop_front();
    int entered = 0;
    for (auto& kv : tickets) if (kv.second.used) entered++;
    reply(res, 200, {{"sold", tickets.size()}, {"entered", entered},
                      {"lastHour", scans.size()}, {"targetPerHour", SCAN_TARGET_PER_HOUR}});
  });

  svr.set_mount_point("/", "../../web/dist");  // gotowa strona serwowana przez ten sam serwer
  svr.set_error_handler([](const httplib::Request& req, httplib::Response& res) {
    if (res.status == 404 && req.path.rfind("/api/", 0) != 0) {  // SPA fallback
      std::ifstream f("../../web/dist/index.html");
      std::string html((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
      res.status = 200;
      res.set_content(html, "text/html");
    }
  });

  int port = std::atoi(env("PORT", "8080").c_str());
  std::cout << "Kirsche tickets: http://0.0.0.0:" << port << "\n";
  svr.listen("0.0.0.0", port);
}
