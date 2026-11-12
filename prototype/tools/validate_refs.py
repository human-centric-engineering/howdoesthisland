"""Reference validator for the HowDoesThisLand model. Every field that holds an id must resolve."""
import json, sys
def validate(M, E=None):
    K = M["knowledge_refs"]
    pools = {
        "framework": {x["id"] for x in K["frameworks"]}, "concept": {x["id"] for x in K["concepts"]},
        "thinker": {x["id"] for x in K["thinkers"]}, "study": {x["id"] for x in K["studies"]},
        "overlay": {x["id"] for x in K.get("overlays", [])},
        "research": {x["id"] for x in M["research"]},
        "dimension": {d["id"] for d in M["dimensions"]} | {l["id"] for l in M["lenses"]} | {d["id"] for d in M.get("extra_dimensions", [])},
        "move": {m["id"] for m in M["moves"]}, "red_flag": {f["id"] for f in M["red_flags"]},
        "content_type": {c["id"] for c in M["content_types"]}, "duty": {d["id"] for d in M["duties"]},
        "archetype": {a["id"] for a in M["archetypes"]}, "perspective": {p["id"] for p in M["perspectives"]},
        "lever": {l["id"] for p in M["perspectives"] for l in p["levers"]}, "balance_rule": {b["id"] for b in M["balance_rules"]},
        "appeal_or_group": {a["id"] for a in M["appeals"]} | {g["id"] for g in M.get("groups", [])} | {"lenses", "influence"},
        "country": {c["id"] for c in M.get("culture", {}).get("countries", [])},
    }
    errs = []
    def chk(kind, val, where):
        if val is None: return
        if val not in pools[kind]: errs.append(f"{where}: {kind} '{val}' not found")
    def grounded(g, where):
        for k, kind in (("frameworks", "framework"), ("concepts", "concept"), ("thinkers", "thinker"), ("studies", "study")):
            for v in g.get(k, []): chk(kind, v, f"{where}.grounded_in.{k}")
    for f in K["frameworks"]:
        for o in f.get("originators", []): chk("thinker", o, f"knowledge_refs.frameworks[{f['id']}].originators")
    for a in M["appeals"]:
        grounded(a["grounded_in"], f"appeals[{a['id']}]")
        for r in a.get("research", []): chk("research", r, f"appeals[{a['id']}].research")
    for d in M["dimensions"] + M["lenses"] + M.get("extra_dimensions", []):
        grounded(d.get("grounded_in", {}), f"dimensions[{d['id']}]")
        for m in d.get("moves", []): chk("move", m, f"dimensions[{d['id']}].moves")
        for r in d.get("research", []): chk("research", r, f"dimensions[{d['id']}].research")
    for m in M["moves"]:
        grounded(m["grounded_in"], f"moves[{m['id']}]")
        for d in m["dimensions"]: chk("dimension", d, f"moves[{m['id']}].dimensions")
        for r in m.get("research", []): chk("research", r, f"moves[{m['id']}].research")
    for f in M["red_flags"]:
        grounded(f["grounded_in"], f"red_flags[{f['id']}]"); chk("dimension", f["dimension"], f"red_flags[{f['id']}].dimension")
        for r in f.get("research", []): chk("research", r, f"red_flags[{f['id']}].research")
    for c in M["content_types"]:
        for x in c["frameworks"]: chk("framework", x, f"content_types[{c['id']}].frameworks")
        for x in c["priority_dimensions"]: chk("dimension", x, f"content_types[{c['id']}].priority_dimensions")
        chk("overlay", c.get("overlay"), f"content_types[{c['id']}].overlay")
    for p in M["perspectives"]:
        grounded(p["gumption"], f"perspectives[{p['id']}]")
        for r in p.get("research", []): chk("research", r, f"perspectives[{p['id']}].research")
        for l in p["levers"]:
            for r in l["refs"]:
                if r.startswith("st_"): chk("study", r, f"perspectives[{p['id']}].levers[{l['id']}].refs")
                else: chk("research", r, f"perspectives[{p['id']}].levers[{l['id']}].refs")
    for m in M["audience_modifiers"]:
        grounded(m.get("grounded_in", {}), f"audience_modifiers[{m['id']}]")
        for r in m.get("research", []): chk("research", r, f"audience_modifiers[{m['id']}].research")
    for a in M["archetypes"]:
        chk("duty", a.get("primary"), f"archetypes[{a['id']}].primary"); chk("duty", a.get("secondary"), f"archetypes[{a['id']}].secondary")
    for r in M["exec_roles"]:
        chk("archetype", r["archetype"], f"exec_roles[{r['id']}].archetype"); chk("duty", r["primary"], f"exec_roles[{r['id']}].primary"); chk("duty", r["secondary"], f"exec_roles[{r['id']}].secondary")
    for c in M["scoring"].get("integrity_caps", []): chk("dimension", c["dimension"], "scoring.integrity_caps")
    for j in M["judges"]: chk("appeal_or_group", j["appeal"], f"judges[{j['id']}].appeal")
    for j in M.get("judge_catalogue", []):
        for x in j["judges"]: chk("appeal_or_group", x, f"judge_catalogue[{j['id']}].judges")
    for g in M.get("groups", []):
        if g.get("judge") and g["judge"] not in {j["id"] for j in M["judges"]}: errs.append(f"groups[{g['id']}].judge '{g['judge']}' not found")
    for k in M.get("length_targets", {}): chk("content_type", k, "length_targets")
    if E:
        for c in E["cases"]:
            w = f"eval[{c['id']}]"; chk("content_type", c["content_type"], w + ".content_type"); x = c["expect"]
            for f in x["flags_present"] + x["flags_absent"]: chk("red_flag", f, w + ".flags")
            for d in x["recommend_dimensions"]: chk("dimension", d, w + ".recommend_dimensions")
            for b in x["balance_rules"]: chk("balance_rule", b, w + ".balance_rules")
            chk("duty", x.get("primary_duty"), w + ".primary_duty")
            chk("archetype", c["audience"].get("archetype"), w + ".audience.archetype")
    return errs
if __name__ == "__main__":
    M = json.load(open(sys.argv[1])); E = json.load(open(sys.argv[2])) if len(sys.argv) > 2 else None
    errs = validate(M, E)
    print(f"{M['meta']['version']}: {len(errs)} dangling reference(s)")
    for e in errs: print("  " + e)
    sys.exit(1 if errs else 0)
