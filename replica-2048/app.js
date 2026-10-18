import {Game,safeStorage} from './engine.js';
const $=selector=>document.querySelector(selector);
const tiles=$('.tile-container'),score=$('.score-container'),best=$('.best-container'),message=$('.game-message');
let renderedScore=0;
function position(p){return `tile-position-${p.x+1}-${p.y+1}`;}
function clearMessage(){message.classList.remove('game-won','game-over');}
function tileElement(tile){
  const wrapper=document.createElement('div'),inner=document.createElement('div');
  const classes=['tile',`tile-${tile.value}`,position(tile.previous||tile)];
  if(tile.value>2048)classes.push('tile-super');
  if(!tile.previous)classes.push(tile.mergedFrom?'tile-merged':'tile-new');
  wrapper.className=classes.join(' ');inner.className='tile-inner';inner.textContent=String(tile.value);wrapper.append(inner);
  if(tile.previous)requestAnimationFrame(()=>{classes[2]=position(tile);wrapper.className=classes.join(' ');});
  if(tile.mergedFrom)tile.mergedFrom.forEach(tileElement);
  tiles.append(wrapper);
}
function render(game){
  requestAnimationFrame(()=>{
    tiles.replaceChildren();
    // The original paints columns first, so overlapping merge layers use this order.
    const live=new Map(game.visual.map(t=>[`${t.x}:${t.y}`,t]));
    for(let x=0;x<4;x++)for(let y=0;y<4;y++)if(game.board[y][x])tileElement(live.get(`${x}:${y}`)||{x,y,value:game.board[y][x]});
    const delta=game.score-renderedScore;renderedScore=game.score;
    score.textContent=String(game.score);best.textContent=String(game.best);
    if(delta>0){const add=document.createElement('div');add.className='score-addition';add.textContent=`+${delta}`;score.append(add);}
    if(game.terminated){message.classList.add(game.over?'game-over':'game-won');message.querySelector('p').textContent=game.over?'Game over!':'You win!';}
  });
}
const game=new Game({storage:safeStorage(),random:()=>Math.random(),onChange:render});
const restart=()=>{clearMessage();game.restart();};
const directions={ArrowUp:0,ArrowRight:1,ArrowDown:2,ArrowLeft:3,k:0,l:1,j:2,h:3,w:0,d:1,s:2,a:3};
document.addEventListener('keydown',event=>{
  if(event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
  const direction=directions[event.key.length===1?event.key.toLowerCase():event.key];
  if(direction!==undefined){event.preventDefault();game.move(direction);}
  else if(event.key.toLowerCase()==='r'){event.preventDefault();restart();}
});
for(const selector of ['.restart-button','.retry-button','.keep-playing-button']){
  for(const type of ['click','touchend'])$(selector).addEventListener(type,event=>{
    event.preventDefault();
    if(selector==='.keep-playing-button'){game.keepPlaying();clearMessage();}else restart();
  });
}
let touchX,touchY;
const board=$('.game-container');
board.addEventListener('touchstart',event=>{
  if(event.touches.length>1||event.targetTouches.length>1)return;
  touchX=event.touches[0].clientX;touchY=event.touches[0].clientY;event.preventDefault();
},{passive:false});
board.addEventListener('touchmove',event=>event.preventDefault(),{passive:false});
board.addEventListener('touchend',event=>{
  if(event.touches.length||event.targetTouches.length)return;
  const dx=event.changedTouches[0].clientX-touchX,dy=event.changedTouches[0].clientY-touchY;
  if(Math.max(Math.abs(dx),Math.abs(dy))>10)game.move(Math.abs(dx)>Math.abs(dy)?dx>0?1:3:dy>0?2:0);
});
// Test/inspection interface: no original engine code is imported or loaded.
window.replicaGame=game;
