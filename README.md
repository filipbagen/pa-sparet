# På resande fot

En laglek för spelledare, storbild och upp till fem lag (Första klass, Dressinen, X2000, Mälartåg, Loket). Spelledaren väljer 2–5 aktiva lag mellan frågorna. Frågor och spelstatus sparas i `data/game.json`. Exempelfrågorna kan redigeras eller tas bort från spelledarvyn.

## Installera och starta i VS Code

1. Installera Node.js 20 eller senare.
2. Öppna projektmappen i VS Code.
3. Öppna **Terminal → New Terminal** och kör `npm start`.
4. Öppna `http://localhost:3000` i webbläsaren.
5. Ange enbart åtkomstkoden. Servern väljer rätt vy automatiskt (`ledare`, `förstaklass`, `dressin`, `x2000`, `mälartåg`, `loket`, `storbild`). Bara aktiva lag kan logga in.
6. Logga in på respektive enhet med dess kod. Varje enhet får en egen inloggning. Koderna finns i `data/codes.json`.

Inga `npm install`-steg behövs; appen använder bara Node.js inbyggda moduler.

## Anslut andra enheter på samma nätverk

1. Anslut datorn och alla mobiler/TV-enheter till samma Wi-Fi eller lokala nätverk.
2. Hitta datorns lokala IPv4-adress. På Windows: kör `ipconfig` i terminalen och läs **IPv4 Address** för det nätverkskort som används.
3. Öppna `http://DIN-IP-ADRESS:3000` på varje annan enhet, till exempel `http://192.168.1.42:3000`.
4. Om sidan inte öppnas, tillåt Node.js inkommande trafik i Windows-brandväggen på privat nätverk. Gästnätverk kan blockera trafik mellan enheter.

Servern lyssnar på alla lokala nätverksgränssnitt. Byt port med `PORT=...` i miljön, exempelvis i PowerShell: `$env:PORT=3001; npm start`.

## Byt åtkomstkoder

1. Stoppa servern med Ctrl+C.
2. Öppna `data/codes.json` och ersätt värdet för varje vy med en egen, unik kod. `host` är spelledare, `screen` är storbild och övriga nycklar är lagen. Alla koder måste vara olika och får inte vara tomma, eftersom koden avgör rollen.
3. Spara filen och kör `npm start` igen. Alla tidigare inloggningar upphör vid omstart.

Mappen `data/` ingår i repot, inklusive åtkomstkoder, frågor, spelstatus och uppladdade medier. Speldata överlever omstart. För säkerhetskopia kopierar du `data/game.json` medan servern är stoppad.

## Spela

### Spelledarens kontrollrum

Spelledarvyn är byggd för en laptop och har två flikar:

- **Show** är manuset under själva showen. Till vänster står hela frågan: alla fem ledtrådar med poängnivå (lästa ledtrådar tonas ner, aktuell ledtråd är stor och markerad), facit från början och alla resefilmsfrågor med facit. Till höger syns varje lags status och svar (t.ex. 🚨 när ett lag drar nödbromsen) och en förhandsvisning av vad som visas på storbilden just nu. Längst ner finns den stora knappen för **nästa steg**, som alltid säger vad som händer härnäst (”Visa ledtråd 3 · 6 p”, ”Avslöja resmålet”, ”Starta Resefilm 1”, ”Avsluta frågan · nästa: …”). Mellan frågorna visar Show nästa ospelade fråga i listan.
- **Förbered** innehåller frågelistan (med status ✓ Spelad / ▶ Pågår och varningar om video saknas), frågeredigeraren, val av 2–5 aktiva lag och manuell poängrättning (+1/−1 eller valfritt antal). **Nollställ spelade** markerar alla frågor som ospelade inför en ny omgång.

Kortkommandon i Show (gäller inte när du skriver i ett fält):

| Tangent | Gör |
|---|---|
| Mellanslag eller → | Nästa steg |
| R | Avslöja resmålet direkt |
| S | Visa/dölj ställningen på storbilden |
| B | Svart skärm på/av |
| P | Spela/pausa videon på storbilden |

**Poäng med ett tryck.** Bredvid varje lags svar finns knappar: för resmålet **✓ Rätt +8** (poängnivån där laget låste svaret) eller **✗ Fel**, för en resefilm **0 rätt / 1 rätt · +1 / 2 rätt · +3** och för en musikfråga **0 / 1 / 2 rätt** (1 poäng per rätt). Ett nytt tryck på ett annat alternativ rättar poängen, och ett nytt tryck på det markerade alternativet ångrar det. Närmast vinner delar fortfarande ut poäng automatiskt.

**Storbilden.** Under förhandsvisningen väljer spelledaren vad TV:n visar: **Spel** (vanligt läge), **Ställning** (lagens poäng, sorterade) eller **Svart skärm** (bara logotypen, t.ex. i en paus). Musik och video pausas i Ställning och Svart skärm och fortsätter där de var när du går tillbaka till Spel. När en video visas finns **▶ Spela / ⏸ Pausa / ⟲ Från början** och en tidslinje. Statusen uppe till höger visar om storbilden är ansluten och om ljudet är aktiverat; är den röd behöver någon klicka **Aktivera ljud** på TV-datorn.

### Resmål och resefilm

Spelledaren startar en fråga. Resmål börjar på 10 poäng och fortsätter till 8, 6, 4 och 2 poäng. Laget drar bromsen nedåt (eller trycker Enter på den) och låser sitt svar. Spelledaren ser alla lags låsta svar direkt och avslöjar sedan resmålet.

Varje resmål har upp till tre **resefilmer**. En resefilm är en MP4-video plus två frågor med facit. Efter avslöjandet kör spelledaren resefilm 1, 2 och 3 i tur och ordning: videon spelas på storbilden (lagen ser ”Titta på storbilden”), sedan visas båda frågorna på storbilden och lagen svarar i två fält, och sist avslöjas facit. En resefilm som lämnas helt tom hoppas över. En resefilm utan video går direkt till frågorna. Poäng per resefilm: 0 rätt = 0 p, 1 rätt = 1 p, 2 rätt = 3 p.

Gamla frågor med två följdfrågor flyttas automatiskt till Resefilm 1 (utan video) när servern startar; ladda upp videon via **Redigera**.

Frågor läggs till med **+ Resmål**, **+ Musikfråga** eller **+ Närmast vinner** under Förbered. Alla fem resmålsledtrådar och facit måste fyllas i. Musikexemplet behöver en MP4-video innan det kan startas. Ordningen i frågelistan ändras med **↑** och **↓** och sparas.

Lagens vyer visar ingen frågetitel eller ledtråd. Varje lag ser sin egen aktuella totalpoäng live. Under ett resmål visas frågans poängnivå, ”Vart är vi påväg?” och nödbromsen. När laget drar bromsen öppnas svarsfältet. Svaret och poängnivån låses när svaret sparas. Rätt svar visas först vid avslöjandet.

På storbilden: klicka **Aktivera ljud** innan spelet börjar. Då spelas `Dressinen.ogg` respektive `ForstaKlass.ogg` när laget drar bromsen, även innan svaret sparas. Resmålsmusiken pausas när ett lag bromsar och fortsätter vid nästa poängnivå. Storbilden visar en animerad nödbroms och vilket lag som drog. Ljudfilerna finns i `public/assets/`. Bara ett lag kan bromsa på varje poängnivå; det andra får vänta till nästa ledtråd. Vid omladdning behöver ljud aktiveras igen; gamla bromsningar spelas inte om.

Storbilden visar bara frågetyp och poäng innan spelledaren avslöjar resmålet. Vid avslöjandet visas enbart rutan med rätt svar. Ljudknappen försvinner när ljudet är aktiverat och storbilden har ingen toppmeny. Alla vyer har knappen **Avsluta** för att logga ut.

För en musikfråga skriver spelledaren en titel, laddar upp en MP4-fil (högst 250 MB) och skriver två frågor med facit. Videon sparas i `data/media/`. Vid start visas **Lyssna och njut** för lagen och bara videon på storbilden. Om webbläsaren stoppar automatisk uppspelning visas knappen **Starta video** på storbilden. Spelledaren visar sedan båda musikfrågorna samtidigt. Varje lag skriver svaren i en gemensam textruta; spelledaren ser de låsta svaren direkt och kan avslöja båda facit.

## Närmast vinner

Spelledaren väljer **Ny Närmast vinner**, skriver en titel och en ledtråd som text och/eller PNG-, JPG- eller WebP-bild (högst 20 MB), och anger hur många poäng närmaste laget får (standard 10). Zooma och flytta kartan direkt till precis det utsnitt lagen ska få se och klicka på rätt plats inom utsnittet. Det synliga kartutsnittet sparas med frågan. Lagen kan zooma in och flytta kartan inom utsnittet, men inte utanför det. Kartan använder Natural Earths riktiga kustlinjer utan ortnamn, platsetiketter eller landgränser. Kartdatan finns lokalt i `public/assets/land.geojson`, så de anslutna enheterna behöver inte internet för kartan.

När frågan startar visas ledtråden (bild och/eller text) på storbilden. Lagens telefoner visar bara kartan och väntar. När spelledaren klickar **Starta 10 sekunder** öppnas kartan och en nedräkning startar på alla skärmar. Nålen ligger alltid på kartan (från start mitt i utsnittet). Lagen drar den med fingret, utan att hålla in, tills tiden är ute och ser bara sin egen nål. Drar man på kartan utanför nålen flyttas kartan. När tiden gått ut visas alla lags nålar på storbilden automatiskt (ett lag som inte hunnit sätta någon nål får ingen nål och kan inte vinna). Spelledaren klickar sedan **Visa rätt plats och resultat**, och då visas rätt plats och en tabell med avståndet från varje lags nål till rätt plats i kilometer. Närmaste laget får poängen automatiskt; vid lika avstånd inom 0,1 km får båda lagen full poäng. Om servern startats om under nedräkningen blir nästa steg-knappen **Visa nålar nu**.

Storbilden spelar den medföljande filen `public/assets/resmal-loop.mp3` i en slinga från det att spelledaren startar ett resmål. Låten pausas vid bromsning och fortsätter vid nästa ledtråd. Den stoppas när resmålet avslöjas eller en annan fråga startar. Klicka **Aktivera ljud** på storbilden innan spelet börjar; webbläsaren kräver en användarinteraktion innan den kan spela ljud automatiskt.

## Test

Kör `npm test`. Testerna kontrollerar bland annat att en laginloggning nekas spelledarens och storbildens URL:er och API-åtgärder, och att lagets data inte innehåller facit, framtida ledtrådar eller det andra lagets svar före avslöjandet.

Appen är avsedd för ett betrott lokalt nätverk. Använd HTTPS via en betrodd proxy om den ska exponeras över internet.
