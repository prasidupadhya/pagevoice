"""Explainable structural signals. Manual/document roles override every vote."""
import re
import unicodedata
from collections import Counter


def fold(text):
    # Accents in headings are orthographic variants. Keep ñ distinct from n.
    return ''.join(c for c in unicodedata.normalize('NFD',text.lower().replace('ñ','\ue000')) if not unicodedata.combining(c)).replace('\ue000','ñ')


FRONT={'preface':('preface','front_matter'),'prefacio':('preface','front_matter'),'prologo':('preface','front_matter'),
       'foreword':('preface','front_matter'),'introduction':('preface','front_matter'),'introduccion':('preface','front_matter'),
       'acknowledgments':('acknowledgments','front_matter'),'acknowledgements':('acknowledgments','front_matter'),'agradecimientos':('acknowledgments','front_matter'),
       'dedication':('dedication','front_matter'),'dedicatoria':('dedication','front_matter'),'copyright':('copyright','front_matter'),
       'creditos':('copyright','front_matter'),'contents':('toc','front_matter'),'table of contents':('toc','front_matter'),'indice':('toc','front_matter'),
       'epigraph':('epigraph','front_matter'),'epigrafe':('epigraph','front_matter'),'about':('biography','front_matter'),
       'author':('biography','front_matter'),'biography':('biography','front_matter'),'biografia':('biography','front_matter'),'sobre':('biography','front_matter')}
BACK={'index':('index','back_matter'),'bibliography':('bibliography','back_matter'),'bibliografia':('bibliography','back_matter'),
      'appendix':('appendix','back_matter'),'appendices':('appendix','back_matter'),'apendice':('appendix','back_matter'),
      'epilogue':('epilogue','back_matter'),'epilogo':('epilogue','back_matter'),'notes':('notes','back_matter'),'notas':('notes','back_matter'),
      'glossary':('glossary','back_matter'),'glosario':('glossary','back_matter')}
CHAPTER=re.compile(r'^(?:(?:chapter|capitulo)\s+\S+|[ivxlcdm]+[.]?$)',re.I)
FIRST=re.compile(r'^(?:(?:chapter|capitulo)\s+(?:1|i|one|uno|primero)\b|i[.]?$)',re.I)


def ordinal(value):
    if value.isdigit():return int(value)
    if not re.fullmatch(r"[ivxlcdm]+",value):return None
    values={"i":1,"v":5,"x":10,"l":50,"c":100,"d":500,"m":1000}
    return sum(-values[c] if i+1<len(value) and values[c]<values[value[i+1]] else values[c] for i,c in enumerate(value))


def analyze(book):
    chapters=book['chapters'];titles=Counter(fold(c['title']).strip() for c in chapters)
    first=next((i for i,c in enumerate(chapters) if FIRST.match(fold(c['title'])) and c.get('evidence')!='spine'),None)
    sections=[];previous_number=None
    for i,c in enumerate(chapters):
        title=c['title'];normalized=fold(title).strip();evidence=c.get('evidence','legacy-spine');role=c.get('role','');words=sum(len(s.split()) for s in c['sentences'])
        signals=[];subkind=None;votes=Counter();reasons=[]
        def vote(kind,weight,reason,value):
            votes[kind]+=weight;signals.append({'kind':kind,'weight':weight,'reason':reason,'evidence':value})
        keyword=next(((k,v) for k,v in {**FRONT,**BACK}.items() if re.match(r'^'+re.escape(k)+r'\b',normalized)),None)
        if keyword:
            key,(subkind,kind)=keyword
            if subkind=='toc' and i>len(chapters)*.75 and key=='indice':kind='back_matter';subkind='index'
            vote(kind,6,'section_title',key)
        if evidence in ('table-of-contents','outline','manual'):vote('chapter',3,'structural_boundary',evidence)
        if CHAPTER.match(normalized) and evidence=='heading':vote('chapter',5,'numbered_heading',title)
        if re.match(r'^(part|parte)\s+\S+',normalized):
            subkind='part_divider';vote('chapter',3,'part_heading',title)
        if first is not None and i<first and evidence in ('spine','legacy-spine','page-fallback'):
            vote('front_matter',2,'before_first_chapter',first)
        typography=c.get('typography') or {}
        if typography.get('heading_ratio',0)>=1.35 and CHAPTER.match(normalized):vote('chapter',2,'heading_typography',typography)
        if role in ('chapter','front_matter','back_matter','unclassified'):
            kind=role;confidence='confirmed' if evidence=='manual' else 'document';level='high';reasons=['manual' if evidence=='manual' else 'epub_semantics']
            signals.insert(0,{'kind':kind,'weight':100,'reason':reasons[0],'evidence':role})
        elif votes:
            ordered=votes.most_common();kind,score=ordered[0];margin=score-(ordered[1][1] if len(ordered)>1 else 0)
            confidence='document' if not keyword and evidence in ('table-of-contents','outline') else 'inferred'
            level='high' if score>=6 and margin>=3 else 'medium' if score>=3 and margin>=2 else 'low'
            if margin<=0:kind='unclassified';level='low'
            reasons=[s['reason'] for s in signals if s['kind']==kind] or ['conflicting_signals']
        else:kind='unclassified';confidence='inferred';level='low';reasons=['insufficient_structure']
        flags=[]
        def flag(code,value):flags.append({'code':code,'evidence':value,'source':c.get('source','')})
        if titles[normalized]>1:flag('duplicate_title',title)
        if words<20:flag('tiny_section',{'words':words})
        if words>12000:flag('huge_section',{'words':words})
        number=re.match(r'^(?:(?:chapter|capitulo)\s+)?(\d+|[ivxlcdm]+)(?:[.]|$|\s)',normalized)
        if kind=='chapter' and number:
            number=ordinal(number[1])
            if previous_number is not None and number!=previous_number+1:flag('numbering_gap',{'previous':previous_number,'current':number})
            previous_number=number
        for text in c['sentences'][:30]:
            if re.search(r'(?:\.{3,}\s*\d+|(?:chapter|capitulo)\s+\d+\s+\d+)',fold(text)):
                flag('toc_inside_body',text[:240]);break
        for page in book.get('source_pages',[]):
            if c.get('source')==f'page:{page.get("page")}' and page.get('removed_margins'):
                flag('running_header_removed',page['removed_margins'])
        if sum(normalized==fold(s).strip(' .') for s in c['sentences'])>1:flag('leaked_running_header',title)
        sections.append({'index':i,'title':title,'kind':kind,'subkind':subkind,'source':c.get('source',''),'evidence':evidence,
                         'confidence':confidence,'confidence_level':level,'reasons':reasons,'signals':signals,'flags':flags,
                         'review':confidence=='inferred' or kind=='unclassified' or bool(flags),'sentences':len(c['sentences']),
                         'words':words,'excerpt':' '.join(c['sentences'][:2])[:600]})
    start=next((s['index'] for s in sections if s['kind']=='chapter'),None)
    if start is None:start=next((s['index'] for s in sections if s['kind']=='unclassified'),0)
    count=sum(s['review'] for s in sections)
    return {'version':2,'revision':3,'method':'local-source-retrieval','start_chapter':start,'sections':sections,'needs_review':bool(count),'review_count':count,
            'warnings':['review_inferred_boundaries'] if count else [],'flags':[dict(section=s['index'],**f) for s in sections for f in s['flags']]}
