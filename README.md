# På resande fot

En laglek för fyra samtidiga vyer: spelledare, Lag Dressin, Lag Första klass och storbild. Frågor och spelstatus sparas i `data/game.json`. Exempelfrågorna kan redigeras eller tas bort från spelledarvyn.

## Installera och starta i VS Code

1. Installera Node.js 20 eller senare.
2. Öppna projektmappen i VS Code.
3. Öppna **Terminal → New Terminal** och kör `npm start`.
4. Öppna `http://localhost:3000` i webbläsaren.
5. Ange enbart åtkomstkoden. Servern väljer rätt vy automatiskt: `dressin` för Lag Dressin, `förstaklass` för Lag Första klass, `ledare` för spelledaren och `storbild` för storbilden.
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
2. Öppna `data/codes.json` och ersätt värdet för varje vy med en egen, unik kod. `host` är spelledare, `dressin` och `forsta` är lagen och `screen` är storbild. Alla fyra koder måste vara olika och får inte vara tomma, eftersom koden avgör rollen.
3. Spara filen och kör `npm start` igen. Alla tidigare inloggningar upphör vid omstart.

Mappen `data/` ingår i repot, inklusive åtkomstkoder, frågor, spelstatus och uppladdade medier. Speldata överlever omstart. För säkerhetskopia kopierar du `data/game.json` medan servern är stoppad.

## Spela

Spelledaren väljer **Starta** för en fråga. Resmål börjar på 10 poäng och fortsätter med **Nästa ledtråd** till 8, 6, 4 och 2 poäng. Laget drar bromsen nedåt (eller trycker Enter på den) och låser sitt svar. Spelledaren kan se båda lagens låsta svar och väljer **Avslöja facit** och sedan **Nästa fråga**.

Frågor läggs till med **Nytt resmål**, **Ny musikfråga** eller **Ny Närmast vinner**. Alla fem resmålsledtrådar och facit måste fyllas i. Exempelfrågorna om Göteborg och ABBA är bara startinnehåll och kan bytas ut. Musikexemplet behöver en MP4-video innan det kan startas.

Spelledaren ändrar ordningen i frågelistan med knapparna **↑** och **↓** bredvid varje fråga. Ordningen sparas och finns kvar efter omstart. I rutan **Poäng** kan spelledaren när som helst lägga till eller dra av poäng för respektive lag. Poängställningen sparas tillsammans med spelet.

Lagens vyer visar ingen frågetitel eller ledtråd. Varje lag ser sin egen aktuella totalpoäng live. Under ett resmål visas frågans poängnivå, ”Vart är vi påväg?” och nödbromsen. När laget drar bromsen öppnas svarsfältet. Svaret och poängnivån låses när svaret sparas. Rätt svar visas först vid avslöjandet.

På storbilden: klicka **Aktivera ljud** innan spelet börjar. Då spelas `Dressinen.ogg` respektive `ForstaKlass.ogg` när laget drar bromsen, även innan svaret sparas. Resmålsmusiken pausas när ett lag bromsar och fortsätter vid nästa poängnivå. Storbilden visar en animerad nödbroms och vilket lag som drog. Ljudfilerna finns i `public/assets/`. Bara ett lag kan bromsa på varje poängnivå; det andra får vänta till nästa ledtråd. Vid omladdning behöver ljud aktiveras igen; gamla bromsningar spelas inte om.

Storbilden visar bara frågetyp och poäng innan spelledaren avslöjar resmålet. Vid avslöjandet visas enbart rutan med rätt svar. Ljudknappen försvinner när ljudet är aktiverat och storbilden har ingen toppmeny. För varje resmål kan spelledaren skriva två följdfrågor med facit i frågeredigeraren. Efter avslöjandet kan spelledaren visa följdfråga 1 och 2 på storbilden, samt avslöja respektive facit. En följdfråga kan lämnas tom om den inte ska användas.

När spelledaren visar en följdfråga får båda lagen samma fråga och varsitt svarsfält. Varje lag kan låsa ett svar per följdfråga; spelledaren ser svaren direkt. När spelledaren avslöjar följdfrågans facit visas det även för lagen. Alla vyer har knappen **Avsluta** för att logga ut, utan toppmeny.

För en musikfråga skriver spelledaren en titel, laddar upp en MP4-fil (högst 250 MB) och skriver två frågor med facit. Videon sparas i `data/media/`. Vid start visas **Lyssna och njut** för lagen och bara videon på storbilden. Om webbläsaren stoppar automatisk uppspelning visas knappen **Starta video** på storbilden. Spelledaren visar sedan båda musikfrågorna samtidigt. Varje lag skriver svaren i en gemensam textruta; spelledaren ser de låsta svaren direkt och kan avslöja båda facit.

## Närmast vinner

Spelledaren väljer **Ny Närmast vinner**, skriver en titel och laddar upp en PNG-, JPG- eller WebP-bild (högst 20 MB). Zooma och flytta kartan direkt till precis det utsnitt lagen ska få se; inga förvalda områden behöver väljas. Klicka på rätt plats inom utsnittet och spara frågan. Det synliga kartutsnittet sparas med frågan och visas för båda lagen och på storbilden. Lagen kan zooma in och flytta kartan inom utsnittet, men inte utanför det. Kartan använder Natural Earths riktiga kustlinjer utan ortnamn, platsetiketter eller landgränser. Kartdatan finns lokalt i `public/assets/land.geojson`, så de anslutna enheterna behöver inte internet för kartan.

När frågan startar visas bilden på storbilden. Lagen ser det valda kartområdet, sätter varsin nål och låser sitt svar. När båda har svarat kan spelledaren klicka **Visa karta på storbilden**, sedan **Visa lagens nålar** och slutligen **Visa rätt plats och resultat**. Avstånden räknas som kortaste avstånd längs jordytan och visas i kilometer. Vid lika avstånd inom 0,1 km visas oavgjort. Resultatet ger inga poäng automatiskt; spelledaren använder poängrutan för att dela ut poäng.

Storbilden spelar den medföljande filen `public/assets/resmal-loop.mp3` i en slinga från det att spelledaren startar ett resmål. Låten pausas vid bromsning och fortsätter vid nästa ledtråd. Den stoppas när resmålet avslöjas eller en annan fråga startar. Klicka **Aktivera ljud** på storbilden innan spelet börjar; webbläsaren kräver en användarinteraktion innan den kan spela ljud automatiskt.

## Test

Kör `npm test`. Testerna kontrollerar bland annat att en laginloggning nekas spelledarens och storbildens URL:er och API-åtgärder, och att lagets data inte innehåller facit, framtida ledtrådar eller det andra lagets svar före avslöjandet.

Appen är avsedd för ett betrott lokalt nätverk. Använd HTTPS via en betrodd proxy om den ska exponeras över internet.
