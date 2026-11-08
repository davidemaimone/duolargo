# DuoLargo — fase 1: diagnostica

Estensione Safari per iPhone Duo. Questa prima versione **non allarga ancora le pagine**: misura come Safari le dispone sullo schermo esterno, sullo schermo interno e in Split View, per capire come riconoscere il lato dei comandi.

## 1. Carica il progetto su GitHub (dal PC)

1. Su github.com crea un repository nuovo, per esempio `duolargo`. Con un repository **pubblico** i minuti di GitHub Actions sono gratuiti; con uno privato i minuti macOS si consumano più in fretta.
2. Estrai lo zip sul PC.
3. Nella pagina del repository vuoto scegli **uploading an existing file** e trascina **il contenuto** della cartella `DuoLargo` (non la cartella stessa), compresa la cartella `.github`. Poi **Commit changes**.
   - Se la cartella `.github` non si carica, crea il file a mano: **Add file › Create new file**, nome `.github/workflows/build.yml`, e incolla il contenuto del file.

## 2. Compila

Il caricamento su `main` avvia da solo la compilazione. Puoi avviarla anche a mano: **Actions › Compila IPA › Run workflow**.

Dopo qualche minuto, nella pagina dell'esecuzione trovi l'artefatto **DuoLargo-ipa**: scaricalo ed estrai `DuoLargo.ipa`. Se la compilazione fallisce, scarica l'artefatto **build-log** e mandamelo.

## 3. Installa sull'iPhone Duo

1. Installa [Sideloadly](https://sideloadly.io) sul PC e collega l'iPhone via USB.
2. Trascina `DuoLargo.ipa` in Sideloadly, inserisci il tuo Apple ID e avvia. Lascia **spenta** qualsiasi opzione che rimuove le estensioni dell'app.
3. Sull'iPhone: **Impostazioni › Generali › VPN e gestione dispositivi**, autorizza il tuo Apple ID come sviluppatore. Se iOS lo chiede, attiva anche la **Modalità sviluppatore**.
4. Con l'account gratuito l'app dura 7 giorni: poi va reinstallata.

## 4. Attiva l'estensione

1. **Impostazioni › App › Safari › Estensioni › DuoLargo**: accendi l'estensione e imposta **Tutti i siti web** su **Consenti**.
2. In Safari tocca l'icona a sinistra della barra degli indirizzi › **Gestisci le estensioni** › accendi DuoLargo.
3. Consigliato: in **Impostazioni › App › Safari** spegni **Precarica primo risultato**, altrimenti alcune pagine si aprono senza estensione finché non le ricarichi.

## 5. Raccogli i dati

Apri una pagina semplice (per esempio it.wikipedia.org) e ripeti in queste quattro situazioni:

| Situazione | Come |
|---|---|
| Schermo esterno | iPhone chiuso |
| Interno, tutto schermo | iPhone aperto, solo Safari |
| Split View, Safari a sinistra | Safari nella metà sinistra |
| Split View, Safari a destra | Safari nella metà destra |

Per ognuna:

1. Tocca la pillola **Duo** in alto e scegli la situazione dal menu.
2. Tocca un punto della pagina vicino al bordo dei comandi di Safari (aggiorna la riga *tocco*).
3. Tocca **Barre di prova**, chiudi il pannello e fai uno **screenshot**.
4. Riapri il pannello e tocca **Copia dati**, poi incolla il testo in una nota.
5. Tocca **Prova cover**, attendi un secondo e tocca di nuovo **Copia dati**.

Confronto utile: apri anche l'app DuoLargo in Split View a sinistra e a destra e annota i margini mostrati in basso.

Mandami testi e screenshot: da lì scriviamo la logica vera.
