; Live SLIDE CENTER — Room Agent
; NSIS installer hooks: bypass permessi Windows 11.
; Eseguiti durante l'installazione (admin) UNA volta sola.
; Il runtime gira come utente normale, niente UAC.
;
; A differenza del Local Agent il Room Agent NON espone porte HTTP
; (e' solo client verso il Local Agent), quindi non servono regole firewall in entrata.
; Servono pero':
;  - Esclusione Defender sulla cartella di output (per non scannare ogni file
;    scaricato in real-time, che rallenta apertura PowerPoint)
;  - Profilo di rete Private per consentire UDP broadcast/mDNS in uscita
;  - Eccezione firewall in USCITA su mDNS (5353/UDP) - opzionale, normalmente
;    l'uscita e' libera ma alcuni endpoint la bloccano.

!macro NSIS_HOOK_POSTINSTALL
  ; ── 1) Defender: esclusione cartella output presentazioni ───────────────
  ;     Il Room Agent scrive in %LOCALAPPDATA%\SlideCenter\<sala>\
  ;     PowerPoint apre file da li': scan continuo = lag visibile.
  ExecWait 'powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Add-MpPreference -ExclusionPath ''$LOCALAPPDATA\SlideCenter'' -Force -ErrorAction SilentlyContinue"'

  ; ── 2) Profilo rete: imposta tutte le interfacce attive a Private ──────
  ;     Necessario per mDNS multicast e UDP broadcast (entrambi bloccati su
  ;     "Public" by default Windows). Errore tollerato se nessuna rete attiva.
  ExecWait 'powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Get-NetConnectionProfile | Where-Object { $_.NetworkCategory -eq ''Public'' } | Set-NetConnectionProfile -NetworkCategory Private -ErrorAction SilentlyContinue"'

  ; ── 3) Firewall: consenti pacchetti UDP in entrata su 5353 (mDNS reply)
  ;     Necessario per ricevere risposte alle query mDNS browse.
  ExecWait 'netsh advfirewall firewall delete rule name="Live SLIDE CENTER Room Agent mDNS"'
  ExecWait 'netsh advfirewall firewall add rule name="Live SLIDE CENTER Room Agent mDNS" dir=in action=allow protocol=UDP localport=5353 program="$INSTDIR\room-agent.exe" profile=private,domain enable=yes'

  ; ── 4) Firewall: consenti pacchetti UDP in entrata effimeri (UDP broadcast reply)
  ;     Le risposte UDP arrivano su porta effimera; consentiamo il programma
  ;     in uscita+entrata su tutte le porte UDP del profilo private.
  ExecWait 'netsh advfirewall firewall delete rule name="Live SLIDE CENTER Room Agent Discovery"'
  ExecWait 'netsh advfirewall firewall add rule name="Live SLIDE CENTER Room Agent Discovery" dir=in action=allow protocol=UDP program="$INSTDIR\room-agent.exe" profile=private,domain enable=yes'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; ── 0) Sprint 4: deattivazione licenza per liberare slot hardware ───────
  ;     `room-agent.exe --deactivate` -> chiama POST /license/deactivate su
  ;     Live WORKS APP e cancella license.enc locale. Senza feature `license`
  ;     compilata e' un no-op (early return innocuo). Errore tollerato:
  ;     l'utente puo' essere offline durante l'uninstall.
  ExecWait '"$INSTDIR\room-agent.exe" --deactivate'

  ExecWait 'netsh advfirewall firewall delete rule name="Live SLIDE CENTER Room Agent mDNS"'
  ExecWait 'netsh advfirewall firewall delete rule name="Live SLIDE CENTER Room Agent Discovery"'
  ExecWait 'powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Remove-MpPreference -ExclusionPath ''$LOCALAPPDATA\SlideCenter'' -Force -ErrorAction SilentlyContinue"'
!macroend
