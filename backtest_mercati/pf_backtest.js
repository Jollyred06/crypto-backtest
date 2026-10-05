const NOW=Math.floor(Date.now()/1000);
const MK={Nasdaq:['^NDX',0],Nikkei:['^N225',0],Oro:['GC=F',0],Petrolio:['CL=F',1],Rame:['HG=F',1],Treasury10y:['ZN=F',1]};
const FX={'EUR/USD':['EURUSD=X',1],'USD/JPY':['USDJPY=X',1],'GBP/USD':['GBPUSD=X',1],'AUD/USD':['AUDUSD=X',1],'USD/CAD':['USDCAD=X',1]};
const RUNS=[
 {n:'A 3 mercati 55/20',set:['Nasdaq','Nikkei','Oro'],src:MK,en:55,ex:20,cost:0.0005},
 {n:'B 6 mercati 55/20',set:Object.keys(MK),src:MK,en:55,ex:20,cost:0.0005},
 {n:'C 6 mercati 100/40',set:Object.keys(MK),src:MK,en:100,ex:40,cost:0.0005},
 {n:'D Forex 150/50',set:Object.keys(FX),src:FX,en:150,ex:50,cost:0.0001},
];
const ATR_N=14,ATR_MULT=3,RISK=0.01,MAXLEV=10,cache={};
async function load(tk){
  if(cache[tk])return cache[tk];
  const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${tk}?period1=315532800&period2=${NOW}&interval=1d`,{headers:{'User-Agent':'Mozilla/5.0'}});
  const x=(await r.json()).chart.result[0],q=x.indicators.quote[0],d=[];
  x.timestamp.forEach((t,i)=>{if([q.open[i],q.high[i],q.low[i],q.close[i]].every(v=>v!=null&&v>0))d.push({k:new Date(t*1000).toISOString().slice(0,10),o:q.open[i],h:q.high[i],l:q.low[i],c:q.close[i]});});
  return cache[tk]=d;
}
function atr(d,s){let sum=0;for(let k=s-ATR_N+1;k<=s;k++){const pc=d[k-1].c;sum+=Math.max(d[k].h-d[k].l,Math.abs(d[k].h-pc),Math.abs(d[k].l-pc));}return sum/ATR_N;}
function series(d,en,ex,cost,short){
  const m=new Map();let pos=null;
  for(let i=en+1;i<d.length;i++){
    const s=i-1,cl=n=>d.slice(s-n,s).map(x=>x.c);
    const hi=Math.max(...cl(en)),lo=Math.min(...cl(en)),hiE=Math.max(...cl(ex)),loE=Math.min(...cl(ex));
    let r=0,done=false;
    if(pos){
      let px=null;
      if((pos.dir===1&&d[s].c<loE)||(pos.dir===-1&&d[s].c>hiE))px=d[i].o;
      else if(pos.dir===1&&d[i].l<=pos.stop)px=Math.min(d[i].o,pos.stop);
      else if(pos.dir===-1&&d[i].h>=pos.stop)px=Math.max(d[i].o,pos.stop);
      if(px!=null){r=pos.size*(pos.dir*(px/d[s].c-1)-cost);pos=null;done=true;}
      else r=pos.size*pos.dir*(d[i].c/d[s].c-1);
    }
    if(!pos&&!done){
      const dir=d[s].c>hi?1:(short&&d[s].c<lo?-1:0);
      if(dir){const e=d[i].o,dist=ATR_MULT*atr(d,s);pos={dir,stop:e-dir*dist,size:Math.min(RISK/(dist/e),MAXLEV)};r=pos.size*(dir*(d[i].c/e-1)-cost);}
    }
    m.set(d[i].k,r);
  }
  return m;
}
function combine(maps){
  const start=maps.map(m=>m.keys().next().value).sort().pop();
  const keys=[...new Set(maps.flatMap(m=>[...m.keys()]))].sort().filter(k=>k>=start);
  return {keys,rets:keys.map(k=>maps.reduce((a,m)=>a+(m.get(k)||0),0))};
}
function stats(keys,rets){
  let eq=1,peak=1,mdd=0,sum=0,sq=0;
  for(const r of rets){eq*=1+r;peak=Math.max(peak,eq);mdd=Math.max(mdd,1-eq/peak);sum+=r;sq+=r*r;}
  const n=rets.length,mean=sum/n,sd=Math.sqrt(sq/n-mean*mean);
  const yrs=(new Date(keys[n-1])-new Date(keys[0]))/(365.25*864e5),ppy=n/yrs;
  return {anni:yrs.toFixed(1),cagr:(100*(Math.pow(eq,1/yrs)-1)).toFixed(1)+'%',vol:(100*sd*Math.sqrt(ppy)).toFixed(1)+'%',sharpe:(mean*Math.sqrt(ppy)/sd).toFixed(2),maxdd:(100*mdd).toFixed(1)+'%'};
}
function add(rows,n,keys,rets){
  const m=rets.length>>1;
  for(const [lab,a,b] of [['tutto',0,rets.length],['1a meta',0,m],['2a meta',m,rets.length]])
    rows.push({run:n,periodo:lab,...stats(keys.slice(a,b),rets.slice(a,b))});
}
(async()=>{
  const rows=[];let ref=null;
  for(const R of RUNS){
    try{
      const maps=[];
      for(const nm of R.set){const [tk,sh]=R.src[nm];maps.push(series(await load(tk),R.en,R.ex,R.cost,sh));}
      const c=combine(maps);if(R.n[0]==='B')ref=c;
      add(rows,R.n,c.keys,c.rets);
    }catch(e){console.log(R.n,'errore:',e.message);}
  }
  if(ref){
    const d=await load('^NDX'),bh=new Map();
    for(let i=1;i<d.length;i++)bh.set(d[i].k,d[i].c/d[i-1].c-1);
    add(rows,'Nasdaq compra-e-tieni',ref.keys,ref.keys.map(k=>bh.get(k)||0));
  }
  console.table(rows);
})();
