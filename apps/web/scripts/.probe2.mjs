import http from 'http'; import fs from 'fs'; import path from 'path'; import puppeteer from 'puppeteer-core'
const ROOT = path.resolve('dist-vite'); const PORT = 8127
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json','.woff2':'font/woff2'}
const server = http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split('?')[0]);if(p==='/'||p==='')p='/index.html';let f=path.join(ROOT,p);if(!fs.existsSync(f)||fs.statSync(f).isDirectory())f=path.join(ROOT,'index.html');try{res.setHeader('Content-Type',mime[path.extname(f)]||'application/octet-stream');fs.createReadStream(f).pipe(res)}catch(e){res.statusCode=404;res.end('nf')}})
await new Promise(r=>server.listen(PORT,'127.0.0.1',r))
const browser = await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:'new',args:['--no-sandbox','--disable-dev-shm-usage']})
const page = await browser.newPage(); await page.setViewport({width:1024,height:900,deviceScaleFactor:1})
await page.setRequestInterception(true); page.on('request',(q)=>{q.url().startsWith(`http://127.0.0.1:${PORT}/`)?q.continue():q.abort()})
await page.evaluateOnNewDocument(()=>{window.requestAnimationFrame=()=>0;window.setInterval=()=>0})
async function probe(tab){
  await page.goto(`http://127.0.0.1:${PORT}/#/concierge`,{waitUntil:'load'})
  await new Promise(r=>setTimeout(r,800))
  if(tab){await page.evaluate((t)=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===t);if(b)b.click()},tab);await new Promise(r=>setTimeout(r,400))}
  const out = await page.evaluate(()=>{
    // The sub-view root <main> is inside the route view (the concierge content column).
    const mains=[...document.querySelectorAll('main')]
    return mains.map(m=>{const cs=getComputedStyle(m);return {snip:m.outerHTML.slice(0,55),pad:cs.padding,disp:cs.display,fd:cs.flexDirection,jc:cs.justifyContent,h:cs.height,oy:cs.overflowY,fg:cs.flexGrow,stf:cs.getPropertyValue('--section-title-fontsize')}})
  })
  console.log('== '+(tab||'Lobby')+' =='); out.forEach(o=>console.log(JSON.stringify(o)))
}
await probe(null); await probe('Earn'); await probe('Spend')
await browser.close(); server.close(); process.exit(0)
