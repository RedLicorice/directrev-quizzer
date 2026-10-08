import re, sys, json, zipfile
from xml.etree import ElementTree as ET
W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
R='{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
z=zipfile.ZipFile(sys.argv[1])
rels={}
for r in ET.fromstring(z.read('word/_rels/document.xml.rels')):
    rels[r.get('Id')]=r.get('Target')
root=ET.fromstring(z.read('word/document.xml'))
out=[]
for p in root.iter(W+'p'):
    txt=''.join(t.text or '' for t in p.iter(W+'t'))
    imgs=[]
    for e in p.iter():
        for k,v in e.attrib.items():
            if k in (R+'embed',) and v in rels and 'media' in rels[v]:
                imgs.append(rels[v])
    out.append({'t':txt,'i':imgs})
json.dump(out,open(sys.argv[2],'w'),ensure_ascii=False)
print(len(out),sum(len(o['i']) for o in out))
