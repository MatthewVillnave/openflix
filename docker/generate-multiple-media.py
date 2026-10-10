"""Synthetic controlled metadata and copies of generated test patterns only."""
from pathlib import Path
from shutil import copyfile
from xml.etree.ElementTree import Element, SubElement, ElementTree
root=Path('/media')
def movie(server,folder,title,provider=None,edition='theatrical',kind='mp4',imdb=None,section='movies'):
    destination=root/server/section/folder
    destination.mkdir(parents=True,exist_ok=True)
    original='Direct Fixture.mp4' if kind=='mp4' else 'Remux Fixture.mkv'
    copyfile(root/'generated'/original,destination/(folder+'.'+kind))
    doc=Element('movie')
    SubElement(doc,'title').text=title
    if provider:SubElement(doc,'uniqueid',type='tmdb',default='true').text=provider
    if imdb:SubElement(doc,'uniqueid',type='imdb').text=imdb
    if edition:SubElement(doc,'tag').text='OpenFlixEdition:'+edition
    ElementTree(doc).write(destination/'movie.nfo',encoding='utf-8',xml_declaration=True)
for server in ['a','b']:
    movie(server,'Shared','Shared work','900000001',kind='mp4' if server=='a' else 'mkv')
    movie(server,'Unique','Unique '+server.upper(),'900000002' if server=='a' else '900000003')
    movie(server,'Collision','Same title different work','900000004' if server=='a' else '900000005')
    movie(server,'Missing','Missing identifiers',edition=None)
    movie(server,'Conflict','Conflicting evidence','900000006',imdb='tt9000001' if server=='a' else 'tt9000002')
    movie(server,'Edition','Edition choices','900000007',edition='theatrical' if server=='a' else 'extended')
    movie(server,'Forbidden','Restricted library item','900000099',section='restricted')
    series=root/server/'tv'/'Synthetic Series'
    season=series/'Season 01'
    season.mkdir(parents=True,exist_ok=True)
    doc=Element('tvshow')
    SubElement(doc,'title').text='Synthetic Series'
    SubElement(doc,'uniqueid',type='tvdb',default='true').text='900000010'
    ElementTree(doc).write(series/'tvshow.nfo',encoding='utf-8',xml_declaration=True)
    for number in [1,2]:
        base='Synthetic Series S01E%02d'%number
        copyfile(root/'generated'/'Direct Fixture.mp4',season/(base+'.mp4'))
        doc=Element('episodedetails')
        SubElement(doc,'title').text='Matched episode' if number==1 else 'Ambiguous episode'
        SubElement(doc,'season').text='1'
        SubElement(doc,'episode').text=str(number)
        if number==1:SubElement(doc,'uniqueid',type='tvdb',default='true').text='900000011'
        SubElement(doc,'tag').text='OpenFlixEdition:theatrical'
        ElementTree(doc).write(season/(base+'.nfo'),encoding='utf-8',xml_declaration=True)
(root/'multiple-ready').touch()
