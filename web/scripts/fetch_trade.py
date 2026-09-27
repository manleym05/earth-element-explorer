import json,urllib.request,time,collections,os
def get(u):
    for t in range(4):
        try: return json.load(urllib.request.urlopen(u,timeout=60))
        except Exception: time.sleep(2+3*t)
    return None
rep=get("https://comtradeapi.un.org/files/v1/app/reference/Reporters.json")
par=get("https://comtradeapi.un.org/files/v1/app/reference/partnerAreas.json")
M49={}
for src in (rep,par):
    for r in (src or {}).get("results",[]):
        code=r.get("reporterCode", r.get("PartnerCode", r.get("id")))
        iso=r.get("reporterCodeIsoAlpha3") or r.get("PartnerCodeIsoAlpha3")
        name=r.get("reporterDesc") or r.get("PartnerDesc") or r.get("text")
        if code is not None and iso: M49[int(code)]={"iso":iso,"name":name}
HS=json.load(open("hs.json"))
B="https://comtradeapi.un.org/public/v1/preview/C/A/HS?period=2023&flowCode=X&cmdCode="
out=json.load(open("trade2023.json")) if os.path.exists("trade2023.json") else {}
for sym,(hs,label) in HS.items():
    if sym in out: continue
    d=get(B+hs+"&partnerCode=0")
    agg=collections.defaultdict(float)
    for r in (d or {}).get("data",[]):
        if r.get("reporterCode") and r.get("primaryValue"): agg[r["reporterCode"]]+=r["primaryValue"]
    top=sorted(agg.items(),key=lambda kv:-kv[1])[:6]
    flows=[]
    for rc,val in top:
        time.sleep(1.1)
        d2=get(B+hs+f"&reporterCode={rc}")
        pa=collections.defaultdict(lambda:[0.0,0.0])
        for r in (d2 or {}).get("data",[]):
            pc=r.get("partnerCode")
            if not pc or pc>=899 or r.get("partner2Code") not in (0,None): continue
            pa[pc][0]+=r.get("primaryValue") or 0; pa[pc][1]+=r.get("netWgt") or 0
        for pc,(v,w) in sorted(pa.items(),key=lambda kv:-kv[1][0])[:5]:
            a,b=M49.get(rc),M49.get(pc)
            if a and b: flows.append({"from":a["iso"],"to":b["iso"],"usd":round(v),"kg":round(w),"fromName":a["name"],"toName":b["name"]})
    out[sym]={"hs":hs,"label":label,"year":2023,"worldExportsUsd":round(sum(agg.values())),"exporters":len(agg),"flows":flows}
    json.dump(out,open("trade2023.json","w"))
    print(sym,len(agg),len(flows),flush=True)
    time.sleep(1.1)
print("DONE",flush=True)
