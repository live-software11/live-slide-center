; Live SLIDE CENTER — Desktop (Sprint D2)
; NSIS installer hooks: bypass permessi Windows + cleanup pulito.
;
; Eseguiti durante install (admin) UNA volta sola. Il runtime gira poi come
; utente normale, niente UAC. Convenzione hook: vedi
; https://v2.tauri.app/distribute/windows-installer/#installer-hooks

!macro NSIS_HOOK_POSTINSTALL
  ; ── 1) Firewall: porta TCP 7300 per server Axum locale ─────────────────
  ;    Necessario perche' i PC sala raggiungono il server admin via LAN.
  ;    Profili: private + domain (mai public per sicurezza eventi pubblici).
  ExecWait 'netsh advfirewall firewall delete rule name="Live SLIDE CENTER Desktop"'
  ExecWait 'netsh advfirewall firewall add rule name="Live SLIDE CENTER Desktop" dir=in action=allow protocol=TCP localport=7300 program="$INSTDIR\slide-center-desktop.exe" profile=private,domain enable=yes'

  ; ── 2) Firewall: UDP 5353 per mDNS (`_slidecenter._tcp.local.`) ────────
  ;    Apre service-discovery LAN cosi' i PC sala trovano il server da soli.
  ExecWait 'netsh advfirewall firewall delete rule name="Live SLIDE CENTER Desktop mDNS"'
  ExecWait 'netsh advfirewall firewall add rule name="Live SLIDE CENTER Desktop mDNS" dir=in action=allow protocol=UDP localport=5353 program="$INSTDIR\slide-center-desktop.exe" profile=private,domain enable=yes'

  ; ── 3) Defender: esclusione cartella dati per evitare scan continuo ────
  ;    `~/SlideCenter` (root data) e `~/.slidecenter` (admin token + license).
  ;    Errore tollerato (Defender disabilitato / non disponibile).
  ExecWait 'powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Add-MpPreference -ExclusionPath ''$PROFILE\SlideCenter'' -Force -ErrorAction SilentlyContinue"'
  ExecWait 'powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Add-MpPreference -ExclusionPath ''$PROFILE\.slidecenter'' -Force -ErrorAction SilentlyContinue"'

  ; ── 4) Profilo rete: forza Private (LAN consentita) ────────────────────
  ;    Errore tollerato se non c'e' rete attiva (es. install offline).
  ExecWait 'powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Get-NetConnectionProfile | Where-Object { $_.NetworkCategory -eq ''Public'' } | Set-NetConnectionProfile -NetworkCategory Private -ErrorAction SilentlyContinue"'

  ; ── 5) Shortcut Desktop (oltre al menu Start gia' creato da NSIS) ──────
  ;    Andrea ha richiesto installer "moderno e completo" → shortcut desktop
  ;    sempre creato. Per disabilitarlo basta cancellarlo manualmente.
  CreateShortcut "$DESKTOP\Live SLIDE CENTER Desktop.lnk" "$INSTDIR\slide-center-desktop.exe" "" "$INSTDIR\slide-center-desktop.exe" 0
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; ── 0) Termina processo se in esecuzione ───────────────────────────────
  ;    `taskkill /F` evita "file in uso" errori durante delete files.
  ;    Errore tollerato se app non e' running.
  ExecWait 'taskkill /F /IM slide-center-desktop.exe /T'

  ; ── 1) Cleanup regole firewall ─────────────────────────────────────────
  ExecWait 'netsh advfirewall firewall delete rule name="Live SLIDE CENTER Desktop"'
  ExecWait 'netsh advfirewall firewall delete rule name="Live SLIDE CENTER Desktop mDNS"'

  ; ── 2) Cleanup esclusione Defender ─────────────────────────────────────
  ExecWait 'powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Remove-MpPreference -ExclusionPath ''$PROFILE\SlideCenter'' -Force -ErrorAction SilentlyContinue"'
  ExecWait 'powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Remove-MpPreference -ExclusionPath ''$PROFILE\.slidecenter'' -Force -ErrorAction SilentlyContinue"'

  ; ── 3) Shortcut desktop ────────────────────────────────────────────────
  Delete "$DESKTOP\Live SLIDE CENTER Desktop.lnk"

  ; ── 4) Cleanup dati utente — chiede SOLO se UI visibile ────────────────
  ;    Default: mantieni dati (anti-perdita slide a un evento).
  ;    Se l'utente sceglie No, rimuove SlideCenter/ + .slidecenter/.
  ;    In modalita silent (uninstall WMI / script CI) salta la prompt e
  ;    mantiene tutto — comportamento conservativo.
  IfSilent skip_data_prompt 0
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON1 "Vuoi mantenere i dati di Live SLIDE CENTER (eventi, slide scaricate, licenza)?$\r$\n$\r$\nScegli S$\u00CC se prevedi di reinstallare l'app sullo stesso PC.$\r$\nScegli NO per una pulizia completa." IDYES skip_data_prompt
    ; L'utente ha scelto NO: pulizia totale.
    RMDir /r "$PROFILE\SlideCenter"
    RMDir /r "$PROFILE\.slidecenter"
  skip_data_prompt:
!macroend
