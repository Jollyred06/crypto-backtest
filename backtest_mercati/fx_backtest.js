// fx_backtest.js - trend-following long/short sui cambi (dati Yahoo, giornalieri)
const PAIRS = { 'EUR/USD':'EURUSD=X','EUR/AUD':'EURAUD=X','EUR/BRL':'EURBRL=X','EUR/CAD':'EURCAD=X','EUR/CHF':'EURCHF=X','EUR/CNY':'EURCNY=X' };
const ENTRY=55, EXIT=20, ATR_N=14, ATR_MULT=3, RISK=0.01, COST=0.0001, MAXLEV=10;

async function load(tk){
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${tk}?period1=1070000000&period2=${Math.floor(Date.now()/1000)}&interval=1d`,{headers:{'User-Agent':'Mozilla/5.0'}});
  const x = (await r.json()).chart.result[0], q = x.indicators.quote[0], d = [];
  x.timestamp.forEach((t,i)=>{ if([q.open[i],q.high[i],q.low[i],q.close[i]].every(v=>v!=null)) d.push({t:t*1000,o:q.open[i],h:q.high[i],l:q.low[i],c:q.close[i]}); });
  return d;
}
function atr(d,s){ let sum=0; for(let k=s-ATR_N+1;k<=s;k++){ const pc=d[k-1].c; sum+=Math.max(d[k].h-d[k].l,Math.abs(d[k].h-pc),Math.abs(d[k].l-pc)); } return sum/ATR_N; }

function run(d){
  let eq=1, peak=1, mdd=0, pos=null; const tr=[];
  const close=px=>{ const g=pos.size*(pos.dir*(px/pos.entry-1)-2*COST); eq*=1+g; tr.push(g); peak=Math.max(peak,eq); mdd=Math.max(mdd,1-eq/peak); pos=null; };
  for(let i=ENTRY+1;i<d.length;i++){
    const s=i-1, cl=n=>d.slice(s-n,s).map(x=>x.c);
    const hi=Math.max(...cl(ENTRY)), lo=Math.min(...cl(ENTRY)), hiE=Math.max(...cl(EXIT)), loE=Math.min(...cl(EXIT));
    let done=false;
    if(pos){
      if((pos.dir===1&&d[s].c<loE)||(pos.dir===-1&&d[s].c>hiE)){ close(d[i].o); done=true; }
      else if(pos.dir===1&&d[i].l<=pos.stop){ close(Math.min(d[i].o,pos.stop)); done=true; }
      else if(pos.dir===-1&&d[i].h>=pos.stop){ close(Math.max(d[i].o,pos.stop)); done=true; }
    }
    if(!pos&&!done){
      const dir=d[s].c>hi?1:d[s].c<lo?-1:0;
      if(dir){ const entry=d[i].o, dist=ATR_MULT*atr(d,s); pos={dir,entry,stop:entry-dir*dist,size:Math.min(RISK/(dist/entry),MAXLEV)}; }
    }
  }
  if(pos) close(d[d.length-1].c);
  const w=tr.filter(x=>x>0), gw=w.reduce((a,b)=>a+b,0), gl=-tr.filter(x=>x<=0).reduce((a,b)=>a+b,0);
  const years=(d[d.length-1].t-d[0].t)/(365.25*864e5);
  return { anni:years.toFixed(1), trade:tr.length, win:(tr.length?100*w.length/tr.length:0).toFixed(0)+'%', pf:(gl?gw/gl:0).toFixed(2), cagr:(100*(Math.pow(eq,1/years)-1)).toFixed(1)+'%', maxdd:(100*mdd).toFixed(1)+'%' };
}

(async()=>{
  const rows=[];
  for(const [name,tk] of Object.entries(PAIRS)){
    try{
      const d=await load(tk), m=d.length>>1;
      for(const [lab,seg] of [['tutto',d],['1a meta',d.slice(0,m)],['2a meta',d.slice(m)]]) rows.push({coppia:name,periodo:lab,...run(seg)});
    }catch(e){ console.log(name,'errore:',e.message); }
  }
  console.table(rows);
})();