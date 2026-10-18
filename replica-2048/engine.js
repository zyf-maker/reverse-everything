// Independent row-compaction engine. E1-E8: verification/EVIDENCE.md.
export class Game {
  constructor({random=Math.random,storage=null,onChange=()=>{}}={}) {
    this.random=random;this.storage=storage;this.onChange=onChange;
    this.best=Number(storage?.getItem('bestScore')||0);this.visual=[];
    const saved=storage?.getItem('gameState');
    if(saved)this.restore(JSON.parse(saved));else this.fresh();
    this.commit();
  }
  fresh(){
    this.board=Array.from({length:4},()=>Array(4).fill(0));
    this.score=0;this.over=false;this.won=false;this.continued=false;this.visual=[];
    this.spawn();this.spawn();
  }
  restore(state){
    this.board=Array.from({length:4},(_,y)=>Array.from({length:4},(_,x)=>state.grid.cells[x][y]?.value||0));
    this.score=state.score;this.over=state.over;this.won=state.won;this.continued=state.keepPlaying;
    this.visual=[];
  }
  serialize(){
    return {grid:{size:4,cells:Array.from({length:4},(_,x)=>Array.from({length:4},(_,y)=>
      this.board[y][x]?{position:{x,y},value:this.board[y][x]}:null))},
      score:this.score,over:this.over,won:this.won,keepPlaying:this.continued};
  }
  get terminated(){return this.over||(this.won&&!this.continued);}
  spawn(){
    const spaces=[];
    for(let x=0;x<4;x++)for(let y=0;y<4;y++)if(!this.board[y][x])spaces.push({x,y});
    if(!spaces.length)return;
    const value=this.random()<.9?2:4;
    const {x,y}=spaces[Math.floor(this.random()*spaces.length)];
    this.board[y][x]=value;this.visual.push({x,y,value});
  }
  available(){
    for(let y=0;y<4;y++)for(let x=0;x<4;x++){
      const v=this.board[y][x];
      if(!v||(x<3&&v===this.board[y][x+1])||(y<3&&v===this.board[y+1][x]))return true;
    }
    return false;
  }
  move(direction){
    if(this.terminated)return false;
    // Gather each line from the destination edge, compact, pair once, then scatter.
    const previous=this.board.map(row=>row.slice());
    const next=Array.from({length:4},()=>Array(4).fill(0));
    const render=[];
    for(let lane=0;lane<4;lane++){
      const coords=Array.from({length:4},(_,i)=>direction===0?{x:lane,y:i}:direction===1?{x:3-i,y:lane}:direction===2?{x:lane,y:3-i}:{x:i,y:lane});
      const entries=coords.filter(p=>previous[p.y][p.x]).map(p=>({...p,value:previous[p.y][p.x]}));
      let dest=0;
      for(let i=0;i<entries.length;i++){
        const a=entries[i],p=coords[dest++];
        if(entries[i+1]?.value===a.value){
          const b=entries[++i],value=a.value*2;
          this.score+=value;if(value===2048)this.won=true;
          next[p.y][p.x]=value;
          render.push({...p,value,mergedFrom:[{...p,value:a.value,previous:{x:a.x,y:a.y}},{...p,value:b.value,previous:{x:b.x,y:b.y}}]});
        }else{
          next[p.y][p.x]=a.value;
          render.push({...p,value:a.value,previous:{x:a.x,y:a.y}});
        }
      }
    }
    if(next.every((row,y)=>row.every((v,x)=>v===previous[y][x])))return false;
    this.board=next;this.visual=render;this.spawn();
    if(!this.available())this.over=true;
    this.commit();return true;
  }
  commit(){
    if(this.score>this.best){this.best=this.score;this.storage?.setItem('bestScore',String(this.best));}
    if(this.over)this.storage?.removeItem('gameState');
    else this.storage?.setItem('gameState',JSON.stringify(this.serialize()));
    this.onChange(this);
  }
  restart(){this.storage?.removeItem('gameState');this.fresh();this.commit();}
  keepPlaying(){this.continued=true;} // E8: no persistence until the next effective move.
}

export function safeStorage(){
  try{const s=window.localStorage;s.setItem('test','1');s.removeItem('test');return s;}
  catch{
    const data=new Map();
    return {getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k),clear:()=>data.clear()};
  }
}
