# Generates tokens.css from tokens.json. Run: python3 design/tokens/build.py
import json,os
D=os.path.dirname(__file__);t=json.load(open(f"{D}/tokens.json"))
out=[":root {","  /* GENERATED from design/tokens/tokens.json by design/tokens/build.py. Do not edit by hand. */"]
def ref(v):
  if isinstance(v,str) and v.startswith("{"): return "var(--"+v.strip("{}").replace(".","-")+")"
  return v
def walk(node,path):
  if "$value" in node:
    v,ty=node["$value"],node.get("$type")
    name="--"+"-".join(path)
    if ty=="gradient": v="linear-gradient(180deg, "+", ".join(f"{s['color']} {round(s['position']*100)}%" for s in v)+")"
    elif ty=="fontFamily": v=", ".join(f"'{x}'" if " " in x or x[0].isupper() else x for x in v)
    elif ty=="shadow": v=f"{v['offsetX']} {v['offsetY']} {v['blur']} {v['spread']} {v['color']}"
    elif ty=="typography":
      for k,x in v.items(): out.append(f"  {name}-{k.replace('fontFamily','family').replace('fontSize','size').replace('fontWeight','weight').replace('lineHeight','line-height').replace('letterSpacing','letter-spacing')}: {ref(x) if k!='fontFamily' else ref(x)};")
      return
    out.append(f"  {name}: {ref(v)};"); return
  for k,c in node.items():
    if not k.startswith("$"): walk(c,path+[k])
walk({k:v for k,v in t.items() if k not in ("breakpoint","deprecated")},[])
out.append("}")
out.append("/* Breakpoints (CSS vars can't be used in @media): "+", ".join(f"{k}={v['$value']}" for k,v in t["breakpoint"].items() if not k.startswith("$"))+" */")
open(f"{D}/tokens.css","w").write("\n".join(out)+"\n")
