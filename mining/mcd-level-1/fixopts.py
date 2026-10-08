import json,re,collections
qs=json.load(open('segmented.json'))
bad=[]
for q in qs:
    if q['options']: 
        q['optstyle']='labeled'; continue
    s=q['stem']
    # trailing run of non-empty text paragraphs
    j=len(s)
    while j>0 and not s[j-1]['t'] and not s[j-1]['i']: j-=1
    k=j
    while k>0 and s[k-1]['t']: k-=1
    run=s[k:j]
    for m_ in range(len(run)-1,-1,-1):
        if run[m_]['t'].rstrip().endswith(('?',':')) and m_<len(run)-1:
            k+=m_+1; run=run[m_+1:]; break
    q['optstyle']='unlabeled'
    if 2<=len(run)<=8 and k>0:
        q['options']=[{'label':chr(65+n),'text':r['t'],'images':r['i']} for n,r in enumerate(run)]
        q['stem']=s[:k]
    else:
        bad.append(q['num'])
json.dump(qs,open('segmented2.json','w'),ensure_ascii=False,indent=1)
print('unresolved',bad)
c=collections.Counter(len(q['options']) for q in qs);print(c)
# answer validity
def letters(a): return re.findall(r'\b[A-F]\b',re.sub(r'\(.*?\)','',a or ''))
inv=[]
for q in qs:
    L=letters(q['answer'])
    if not L or any(ord(l)-65>=len(q['options']) for l in L): inv.append((q['num'],q['answer'],len(q['options'])))
print('invalid/missing answers',inv)
print('multi',[ (q['num'],q['answer']) for q in qs if len(letters(q['answer']))>1])
print('select-count hint in stem:',[(q['num'],q['answer']) for q in qs if re.search(r'\((choose|select) (two|three|2|3)',' '.join(x['t'] for x in q['stem']),re.I)])
