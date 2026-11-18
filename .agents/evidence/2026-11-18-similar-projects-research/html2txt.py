import sys,re,html
from html.parser import HTMLParser
class P(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True); self.out=[]; self.skip=0
    def handle_starttag(self,t,a):
        if t in ('script','style','noscript','svg'): self.skip+=1
        if t in ('p','div','br','li','tr','h1','h2','h3','h4','section','article','pre'): self.out.append('\n')
        if t in ('td','th'): self.out.append('\t')
    def handle_endtag(self,t):
        if t in ('script','style','noscript','svg') and self.skip: self.skip-=1
        if t in ('h1','h2','h3','h4'): self.out.append('\n')
    def handle_data(self,d):
        if not self.skip: self.out.append(d)
p=P(); p.feed(open(sys.argv[1],encoding='utf-8',errors='replace').read())
t=''.join(p.out); t=re.sub(r'[ \t]+',' ',t); t=re.sub(r'\n\s*\n+','\n\n',t)
open(sys.argv[2],'w',encoding='utf-8').write(t)
print(len(t))
