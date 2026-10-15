// WebView shell for the interactive terminal: xterm.js (+ fit addon)
// inlined from the vendored dist plus a small bridge script. The phone
// renders with zero network access.
//
// Bridge contract (JSON over window.ReactNativeWebView.postMessage):
//   webview -> RN  {type:"ready"}                        terminal open, send output
//   webview -> RN  {type:"input", data:string}           user keystrokes -> socket
//   webview -> RN  {type:"resize", cols:number, rows:number}  fitted dims -> PUT size
//   RN -> webview  __ptyWrite(string)                    append output (queued, in order)
//   RN -> webview  __ptyFit()                            refit + report dims
//   RN -> webview  __ptyTheme(dark:boolean)              follow the app theme
//   RN -> webview  __ptyPalette(bg,fg,cursor,sel:string)  server-theme colors
//     (__ptyTheme stays for compatibility; __ptyPalette is the same xterm
//     setOption call with explicit colors from the opencode theme mapping.)
//
// Takes the vendor sources as arguments (instead of importing the generated
// module) so this file stays runnable under plain `node --test` — local
// value imports are extensionless for Metro and do not resolve under node.
// The screen composes buildTerminalHtml() with terminal-vendor.generated.ts.

// Runs inside the WebView before anything else the page does. Defines the
// __pty* entry points and posts {type:"ready"} once xterm is open.
export const TERMINAL_INIT_JS = `(function(){
var post=function(o){window.ReactNativeWebView.postMessage(JSON.stringify(o));};
var term=new Terminal({cursorBlink:true,fontSize:14,scrollback:5000,theme:{background:'#0a0a0a'}});
var fit=new FitAddon.FitAddon();
term.loadAddon(fit);
term.open(document.getElementById('t'));
fit.fit();
var chain=Promise.resolve();
window.__ptyWrite=function(s){chain=chain.then(function(){return new Promise(function(done){term.write(s,done);});});};
window.__ptyFit=function(){try{fit.fit();var d=fit.proposeDimensions();if(d&&d.cols>0&&d.rows>0){post({type:'resize',cols:d.cols,rows:d.rows});}}catch(e){}};
window.__ptyTheme=function(dark){term.setOption('theme',{background:dark?'#0a0a0a':'#ffffff',foreground:dark?'#e5e5e5':'#0a0a0a',cursor:dark?'#e5e5e5':'#0a0a0a',selectionBackground:dark?'#333333':'#cce5ff'});};
window.__ptyPalette=function(bg,fg,cursor,sel){term.setOption('theme',{background:bg,foreground:fg,cursor:cursor,selectionBackground:sel});};
term.onData(function(d){post({type:'input',data:d});});
term.onResize(function(s){if(s&&s.cols>0&&s.rows>0){post({type:'resize',cols:s.cols,rows:s.rows});}});
post({type:'ready'});
})();`

export interface TerminalVendor {
  css: string
  js: string
  fit: string
}

export function buildTerminalHtml(vendor: TerminalVendor): string {
  for (const [name, text] of [["xterm.js", vendor.js], ["addon-fit.js", vendor.fit]] as const) {
    if (text.includes("</script")) throw new Error(`terminal: ${name} contains "</script" — cannot inline`)
  }
  if (vendor.css.includes("</style")) throw new Error('terminal: xterm.css contains "</style" — cannot inline')
  return (
    "<!doctype html><html><head><meta name=\"viewport\" content=\"width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no\">" +
    "<style>html,body{margin:0;padding:0;height:100%;overflow:hidden}#t{height:100%;width:100%;padding:4px;box-sizing:border-box}" +
    vendor.css +
    "</style></head><body>" +
    "<div id=\"t\"></div>" +
    "<script>" + vendor.js + "</script>" +
    "<script>" + vendor.fit + "</script>" +
    "<script>" + TERMINAL_INIT_JS + "</script>" +
    "</body></html>"
  )
}
