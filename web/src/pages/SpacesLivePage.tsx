import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { HeaderNav } from '../components/HeaderNav'
import { useUser } from '../context/UserContext'
import { listBinders } from '../api/binders'
import { getOwnedCards } from '../api/collection'
import { createDisplayCase, createSpace, listSpaces, setDisplayLights } from '../api/rooms'
import { listBoxes } from '../api/storage'
import type { Binder, Card, CollectionSpace, StorageBox } from '../types'
import '../styles/spaces-concept.css'

export function SpacesLivePage(){
  const {user}=useUser(),navigate=useNavigate()
  const [spaces,setSpaces]=useState<CollectionSpace[]>([]),[boxes,setBoxes]=useState<StorageBox[]>([]),[binders,setBinders]=useState<Binder[]>([])
  const [cards,setCards]=useState<Card[]>([]),[view,setView]=useState<'home'|'displays'>('home')
  const [selectedId,setSelectedId]=useState(''),[loading,setLoading]=useState(true),[error,setError]=useState('')
  const load=async()=>{if(!user?.id)return;setLoading(true);setError('');try{const [s,b,bi,owned]=await Promise.all([listSpaces(user.id),listBoxes(user.id),listBinders(user.id),getOwnedCards(user.id)]);setSpaces(s);setBoxes(b);setBinders(bi);setCards(owned.map(entry=>entry.card));setSelectedId(current=>current||s.find(x=>x.isDefault)?.id||s[0]?.id||'')}catch(e){setError(e instanceof Error?e.message:'Could not load spaces')}finally{setLoading(false)}}
  useEffect(()=>{void load()},[user?.id])
  const selected=spaces.find(s=>s.id===selectedId)||spaces[0]
  const spaceBoxes=useMemo(()=>boxes.filter(b=>!selected||b.spaceId===selected.id),[boxes,selected])
  const spaceBinders=useMemo(()=>binders.filter(b=>!selected||b.spaceId===selected.id),[binders,selected])
  const addSpace=async()=>{if(!user?.id)return;const name=window.prompt('Name this collection space')?.trim();if(!name)return;try{const created=await createSpace(user.id,name,'custom');setSpaces(all=>[...all,created]);setSelectedId(created.id)}catch(e){setError(e instanceof Error?e.message:'Could not create space')}}
  if(loading)return <main className="page-tracker spaces-concept"><div className="spaces-live-status">Building your collection room…</div></main>
  return <main className="page-tracker spaces-concept"><div id="app" style={{display:'block'}}>
    <header className="spaces-site-header"><button className="logo spaces-home-button" onClick={()=>setView('home')}>MY <span>SPACES</span></button><div className="user-badge">● <b>{user?.username||'Collector'}</b></div><input className="header-search" placeholder="Search cards, binders, boxes, or locations…"/><HeaderNav/></header>
    {error&&<div className="spaces-live-error"><span>{error}</span><button onClick={load}>Retry</button></div>}
    {selected&&view==='home'?<section className="spaces-home"><header><small>YOUR CARD-COLLECTING WORLD</small><h1>Every discovery has a place.</h1><p>Organize every physical box, binder, variant, condition, and display copy.</p><div className="atlas-elements"><span className="ember">△ Ember</span><span className="tide">≈ Tide</span><span className="grove">◇ Grove</span><span className="spark">ϟ Spark</span><span className="aether">✦ Aether</span></div></header>
      <div className="main-space"><div className="space-art"><div className="space-architecture"><div className="art-storage"><i/><i/><i/><i/><i/><i/></div><div className="art-binders"><i/><i/><i/><i/><i/></div><div className="art-case"><span/><span/><span/><span/></div><div className="atlas-compass"><i/><b>✦</b></div></div></div><div className="space-info"><small>{selected.isDefault?'PRIMARY EXPEDITION SPACE':selected.spaceType.replaceAll('_',' ').toUpperCase()}</small><h2>{selected.name}</h2><p>Your live Scala-backed collection space.</p><div className="space-destinations">
        <button onClick={()=>navigate('/spaces/default/storage')}><i>▦</i><span><b>Card Archive</b><small>{spaceBoxes.length} boxes across {selected.storageUnits.length} shelf units</small></span><strong>›</strong></button>
        <button onClick={()=>navigate('/spaces/default/storage')}><i>▥</i><span><b>Field Guide Library</b><small>{spaceBinders.length} binders</small></span><strong>›</strong></button>
        <button onClick={()=>setView('displays')}><i>✦</i><span><b>Discovery Gallery</b><small>{selected.displayCases.length} illuminated cases</small></span><strong>›</strong></button>
      </div></div></div>
      <div className="other-spaces"><header><h3>Your expedition spaces</h3><button onClick={addSpace}>+ Add space</button></header><div>{spaces.filter(s=>s.id!==selected.id).map((space,i)=><button key={space.id} onClick={()=>setSelectedId(space.id)}><i className={`other-icon icon-${i%3}`}/><span><b>{space.name}</b><small>{space.storageUnits.length} storage units · {space.displayCases.length} displays</small></span><strong>›</strong></button>)}</div></div>
    </section>:selected?<LiveDisplays userId={user?.id||''} space={selected} cards={cards} onBack={()=>setView('home')} onReload={load}/>:<section className="spaces-live-status"><h2>No collection space found</h2><button onClick={addSpace}>Create your first space</button></section>}
  </div></main>
}

function LiveDisplays({userId,space,cards,onBack,onReload}:{userId:string;space:CollectionSpace;cards:Card[];onBack:()=>void;onReload:()=>Promise<void>}){
  const display=space.displayCases[0],shown=cards.slice(0,4)
  const add=async()=>{await createDisplayCase(userId,{spaceId:space.id,name:'Illuminated Collection',caseType:'lit_cabinet',preset:'collector_led',frameColor:'#17141F',lightColor:'#FFF1B8',shelfCount:3,slotsPerShelf:4});await onReload()}
  const toggle=async()=>{if(!display)return;await setDisplayLights(userId,display.id,!display.lightEnabled);await onReload()}
  return <section className={`display-gallery ${display?.lightEnabled?'lights-on':'lights-off'}`}><header className="gallery-heading"><div><button className="inline-back" onClick={onBack}>← {space.name}</button><small>DISCOVERY GALLERY</small><h2>{display?.name||'Display Gallery'}</h2><p>{display?`${display.shelfCount} shelves · ${display.slots.length} saved slots`:'No display case yet'}</p></div><div>{display&&<button onClick={toggle}>{display.lightEnabled?'☀ Lights on':'☾ Lights off'}</button>}<button className="primary" onClick={add}>+ Add display case</button></div></header>{display?<div className="gallery-stage"><div className="gallery-wall"><div className="gallery-title"><small>{display.caseType.replaceAll('_',' ').toUpperCase()}</small><b>{display.name}</b><i/></div></div><div className="gallery-floor"/><section className="museum-cabinet"><div className="cabinet-crown"><span><small>CURATED COLLECTION</small><b>{display.name}</b></span><i className="cabinet-lock">◆</i></div><div className="led top-led"/><div className="cabinet-interior"><i className="back-panel"/><i className="door left-door"/><i className="door right-door"/><i className="center-seam"/><i className="handle left-handle"/><i className="handle right-handle"/><div className="display-row row-one">{shown.slice(0,2).map(card=><button key={card.id}><i className="spotlight"/><img src={card.images.small} alt={card.name}/><em className="card-stand"/><span><b>{card.name}</b><small>{card.rarity||'Owned card'}</small></span></button>)}</div><i className="glass-shelf shelf-one"/><i className="under-led led-one"/><div className="display-row row-two">{shown.slice(2).map(card=><button key={card.id}><i className="spotlight"/><img src={card.images.small} alt={card.name}/><em className="card-stand"/><span><b>{card.name}</b><small>{card.rarity||'Owned card'}</small></span></button>)}</div><i className="glass-shelf shelf-two"/><i className="under-led led-two"/><div className="empty-display-row"><button>+ Place an owned copy</button></div><i className="glass-reflection"/></div><footer><span><i className="green"/> Settings saved</span><span>{display.slots.length} slots</span><span>LED display</span><span>🔒 Curated</span></footer><div className="cabinet-base"><i/><i/><i/></div></section></div>:<div className="spaces-live-status"><h2>Build your first real display case</h2><p>Cases have persisted lighting, shelves, and copy-level card slots.</p><button onClick={add}>Add illuminated cabinet</button></div>}</section>
}
