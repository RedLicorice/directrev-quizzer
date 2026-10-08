import json,re,zipfile,os,collections
p=json.load(open('paras.json'))
z=zipfile.ZipFile('src/x.bin')
allm={n[len('word/'):] for n in z.namelist() if n.startswith('word/media/')}
used={x for o in p for x in o['i']}
print('media',len(allm),'referenced',len(used),'unreferenced',sorted(allm-used))
qre=re.compile(r'\s*(?:## )?Question: ?(\d+)\s*$')
idx=[i for i,o in enumerate(p) if qre.match(o['t'])]
idx.append(len(p))
optre=re.compile(r'^\s*([A-F])[\.\)]\s*(.*)$')
qs=[]
for a,b in zip(idx,idx[1:]):
    num=int(qre.match(p[a]['t']).group(1))
    blk=p[a+1:b]
    stem=[];opts=[];expl=[];ans=None;mode='stem';cur=None
    for o in blk:
        t=o['t'].strip()
        if re.match(r'^Option [A-F]$',t): continue
        if t.startswith('Explanation'):
            mode='expl'; continue
        m=re.match(r'^Answer:\s*(.*)$',t)
        if m and mode!='stem' or (m and mode=='stem'):
            ans=m.group(1); mode='expl'; continue
        if mode=='stem':
            mt=re.match(r'^(.*\S)\s+A\)\s*$',t)
            if mt and not opts:
                stem.append({'t':mt.group(1),'i':[]})
                cur={'label':'A','text':'','images':list(o['i'])}; opts.append(cur); continue
            m=optre.match(t)
            if m and (m.group(1)=='A' or opts):
                cur={'label':m.group(1),'text':m.group(2),'images':list(o['i'])}; opts.append(cur); continue
            if cur is not None:
                if t: cur['text']=(cur['text']+' '+t).strip()
                cur['images']+=o['i']
            else:
                stem.append({'t':t,'i':o['i']})
        else:
            if t or o['i']: expl.append({'t':t,'i':o['i']})
    qs.append({'num':num,'stem':stem,'options':opts,'answer':ans,'expl':expl})
json.dump(qs,open('segmented.json','w'),ensure_ascii=False,indent=1)
print(len(qs))
nopt=collections.Counter(len(q['options']) for q in qs);print('options count',nopt)
print('no answer',[q['num'] for q in qs if not q['answer']])
print('answer formats',collections.Counter(re.sub(r'\(.*\)','(X)',q['answer'] or '') for q in qs).most_common(20))
print('opts no text & no image',[q['num'] for q in qs for o in q['options'] if not o['text'] and not o['images']])
print('nums sequential',[q['num'] for q in qs]==list(range(1,227)))
print('img-only options q',sum(1 for q in qs if q['options'] and all(not o['text'] for o in q['options'])))
