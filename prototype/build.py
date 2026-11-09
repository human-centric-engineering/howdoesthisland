import json
m=json.dumps(json.load(open('howdoesthisland_model.json')),ensure_ascii=False,separators=(',',':')).replace('</','<\\/')
e=json.dumps(json.load(open('howdoesthisland_eval_set.json')),ensure_ascii=False,separators=(',',':')).replace('</','<\\/')
css=open('dist/app.css').read(); js=open('dist/app.js').read().replace('</script','<\\/script')
s=open('shell.html').read()
s=s.replace('/*TAILWIND*/',css).replace('/*APP*/',js).replace('__MODEL__',m).replace('__EVAL__',e)
open('dist/howdoesthisland.html','w').write(s); print(len(s))
