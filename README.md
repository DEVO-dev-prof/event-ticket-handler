# event-ticket-handler
Handler Events ticket 



cd web && npm run build. Potem ./kirsche (uruchamiany z server/build) serwuje strone z web/dist.

Adresy

/            strona z biletami
/#admin      edycja tytulow, opisow, daty, adresu, biletow (token admina)
/#scan       skaner QR na bramce (token obslugi)

Platnosci

POST /api/orders w server/main.cpp wydaje bilety od razu. Przed sprzedaza podlacz bramke platnosci
(Stripe / Przelewy24 / BLIK) i wydawaj bilety dopiero po potwierdzeniu wplaty (webhook).

Sama strona (demo, bez serwera)

Ustaw zmienna VITE_DEMO=true (lokalnie: web/.env -> VITE_DEMO=true; na Vercelu: Settings > Environment Variables).
Strona dziala wtedy bez C++: timer, bilety i panel /#admin dzialaja na danych w pamieci przegladarki
(zmiany znikaja po odswiezeniu). Do prawdziwej sprzedazy usun zmienna i podlacz serwer.
