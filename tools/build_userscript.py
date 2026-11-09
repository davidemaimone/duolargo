#!/usr/bin/env python3
"""Genera userscript/duolargo.user.js a partire da Extension/Resources/largo.js.

Lo userscript serve per provare le modifiche su iPhone senza reinstallare l'app:
si installa con l'app gratuita "Userscripts" e si aggiorna aprendo il suo link in Safari.
Uso: python3 tools/build_userscript.py <versione>
"""
import pathlib, sys

root = pathlib.Path(__file__).resolve().parent.parent
version = sys.argv[1] if len(sys.argv) > 1 else "0.0.0"
url = "https://raw.githubusercontent.com/davidemaimone/duolargo/main/userscript/duolargo.user.js"

header = f"""// ==UserScript==
// @name         DuoLargo
// @namespace    io.github.davidemaimone.duolargo
// @version      {version}
// @description  Pagine a tutta larghezza sullo schermo esterno di iPhone Duo (versione di prova).
// @match        *://*/*
// @run-at       document-end
// @inject-into  content
// @noframes
// @grant        GM.getValue
// @grant        GM.setValue
// @updateURL    {url}
// @downloadURL  {url}
// ==/UserScript==

// File generato da tools/build_userscript.py: non modificarlo a mano.
const DUOLARGO_USERSCRIPT = true;

"""
body = (root / "Extension/Resources/largo.js").read_text()
out = root / "userscript/duolargo.user.js"
out.write_text(header + body)
print(f"scritto {out} ({version})")
