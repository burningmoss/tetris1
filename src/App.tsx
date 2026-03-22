import React, { useState, useEffect, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import confetti from 'canvas-confetti';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, Users, Play, Pause, RotateCcw, Keyboard, Monitor, Zap, X, LayoutGrid, Globe } from 'lucide-react';
import { useTetris } from './hooks/useTetris';
import { TetrisBoard } from './components/TetrisBoard';
import { Leaderboard } from './components/Leaderboard';
import { GameState } from './types';

const socket: Socket = io();

const stringToSeed = (str: string) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
};

export default function App() {
  const [nickname, setNickname] = useState('');
  const [isJoined, setIsJoined] = useState(false);
  const [mode, setMode] = useState<'single' | 'local_pk' | 'online_pk' | null>(null);
  const [leaderboard, setLeaderboard] = useState<{ name: string; score: number }[]>([]);
  const [opponentState, setOpponentState] = useState<GameState | null>(null);
  const [pkRoom, setPkRoom] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [showFullLeaderboard, setShowFullLeaderboard] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);

  // Player 1 (Main)
  const p1 = useTetris();
  // Player 2 (Local PK)
  const p2 = useTetris();

  // Sync speed in PK mode
  useEffect(() => {
    if (mode === 'local_pk') {
      const max = Math.max(p1.level, p2.level);
      if (p1.level < max) p1.setLevel(max);
      if (p2.level < max) p2.setLevel(max);
    } else if (mode === 'online_pk' && opponentState) {
      const max = Math.max(p1.level, opponentState.level);
      if (p1.level < max) p1.setLevel(max);
    }
  }, [p1.level, p2.level, mode, opponentState]);

  // Handle line clear effects (Firework sound)
  const playClearSound = useCallback(() => {
    confetti({
      particleCount: 100,
      spread: 120,
      origin: { y: 0.6 },
      colors: ['#006633', '#ffffff', '#ffd700', '#ff0000', '#0000ff', '#ff00ff', '#00ffff']
    });
    
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const now = audioCtx.currentTime;

      // 1. Main Explosion "Thump" (Low frequency)
      const thump = audioCtx.createOscillator();
      const thumpGain = audioCtx.createGain();
      thump.type = 'sine';
      thump.frequency.setValueAtTime(150, now);
      thump.frequency.exponentialRampToValueAtTime(40, now + 0.2);
      thumpGain.gain.setValueAtTime(0.5, now);
      thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      thump.connect(thumpGain);
      thumpGain.connect(audioCtx.destination);
      thump.start(now);
      thump.stop(now + 0.3);

      // 2. Sharp "Crack" (High frequency noise)
      const bufferSize = audioCtx.sampleRate * 0.1;
      const crackBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      const crackData = crackBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) crackData[i] = Math.random() * 2 - 1;
      
      const crack = audioCtx.createBufferSource();
      crack.buffer = crackBuffer;
      const crackFilter = audioCtx.createBiquadFilter();
      crackFilter.type = 'highpass';
      crackFilter.frequency.setValueAtTime(2000, now);
      const crackGain = audioCtx.createGain();
      crackGain.gain.setValueAtTime(0.3, now);
      crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      crack.connect(crackFilter);
      crackFilter.connect(crackGain);
      crackGain.connect(audioCtx.destination);
      crack.start(now);

      // 3. Decaying "Sizzle/Crackle" (Filtered noise)
      const sizzleSize = audioCtx.sampleRate * 1.5;
      const sizzleBuffer = audioCtx.createBuffer(1, sizzleSize, audioCtx.sampleRate);
      const sizzleData = sizzleBuffer.getChannelData(0);
      for (let i = 0; i < sizzleSize; i++) sizzleData[i] = Math.random() * 2 - 1;

      const sizzle = audioCtx.createBufferSource();
      sizzle.buffer = sizzleBuffer;
      const sizzleFilter = audioCtx.createBiquadFilter();
      sizzleFilter.type = 'bandpass';
      sizzleFilter.frequency.setValueAtTime(1500, now);
      sizzleFilter.frequency.exponentialRampToValueAtTime(800, now + 1.2);
      const sizzleGain = audioCtx.createGain();
      sizzleGain.gain.setValueAtTime(0.15, now + 0.05);
      sizzleGain.gain.exponentialRampToValueAtTime(0.001, now + 1.5);
      sizzle.connect(sizzleFilter);
      sizzleFilter.connect(sizzleGain);
      sizzleGain.connect(audioCtx.destination);
      sizzle.start(now + 0.05);
    } catch (e) {
      console.warn('Audio context failed', e);
    }
  }, []);

  useEffect(() => {
    if (p1.lines > 0) playClearSound();
  }, [p1.lines, playClearSound]);

  useEffect(() => {
    if (p2.lines > 0) playClearSound();
  }, [p2.lines, playClearSound]);

  // Countdown logic
  useEffect(() => {
    if (countdown === null) return;
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    } else if (countdown === 0) {
      const timer = setTimeout(() => {
        setCountdown(null);
        p1.setIsPaused(false);
        p2.setIsPaused(false);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown, p1, p2]);

  // Socket listeners
  useEffect(() => {
    socket.on('leaderboard_update', (data) => setLeaderboard(data));
    socket.on('waiting_for_opponent', () => setWaiting(true));
    socket.on('match_found', ({ room }) => {
      setPkRoom(room);
      setWaiting(false);
      setCountdown(3);
      // Use room name as seed for synchronized pieces
      const seed = stringToSeed(room);
      p1.resetGame(seed);
    });
    socket.on('opponent_state', (state) => setOpponentState(state));
    socket.on('opponent_game_over', () => {
      // Submit current player's score as they won
      socket.emit('submit_score', { name: nickname, score: p1.score });
      alert('Opponent Game Over! You Win!');
      setMode(null);
      setPkRoom(null);
    });

    return () => {
      socket.off('leaderboard_update');
      socket.off('waiting_for_opponent');
      socket.off('match_found');
      socket.off('opponent_state');
      socket.off('opponent_game_over');
    };
  }, [p1.resetGame]);

  // Sync game state in online multiplayer
  useEffect(() => {
    if (mode === 'online_pk' && pkRoom && countdown === null) {
      socket.emit('game_state_sync', {
        room: pkRoom,
        state: { 
          board: p1.board, 
          score: p1.score, 
          level: p1.level, 
          lines: p1.lines, 
          gameOver: p1.gameOver, 
          nickname 
        }
      });
    }
  }, [p1.board, p1.score, p1.level, p1.lines, p1.gameOver, mode, pkRoom, nickname, countdown]);

  // Handle game over submission (Both players)
  useEffect(() => {
    if (isJoined) {
      if (mode === 'local_pk') {
        // In Local PK, if either player loses, the game ends for both
        if (p1.gameOver || p2.gameOver) {
          socket.emit('submit_score', { name: `${nickname} (P1)`, score: p1.score });
          socket.emit('submit_score', { name: `${nickname} (P2)`, score: p2.score });
          // We don't force both to gameOver state here because useTetris handles its own state,
          // but the UI will show the game over overlay for P1.
        }
      } else if (mode === 'single' && p1.gameOver) {
        socket.emit('submit_score', { name: nickname, score: p1.score });
      } else if (mode === 'online_pk' && p1.gameOver && pkRoom) {
        socket.emit('submit_score', { name: nickname, score: p1.score });
        socket.emit('game_over', { room: pkRoom });
      }
    }
  }, [p1.gameOver, p2.gameOver, isJoined, nickname, p1.score, p2.score, mode, pkRoom]);

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (nickname.trim()) {
      socket.emit('join_game', { nickname });
      setIsJoined(true);
    }
  };

  const startOnlinePK = () => {
    setMode('online_pk');
    p1.setIsPaused(true);
    socket.emit('find_match');
  };

  const startLocalPK = () => {
    setMode('local_pk');
    setCountdown(3);
    p1.setIsPaused(true);
    p2.setIsPaused(true);
    const sharedSeed = Math.random();
    p1.resetGame(sharedSeed);
    p2.resetGame(sharedSeed);
  };

  const startSingle = () => {
    setMode('single');
    setCountdown(3);
    p1.setIsPaused(true);
    p1.resetGame(Math.random());
  };

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!mode || p1.isPaused || countdown !== null) return;

      // Prevent scrolling for game keys
      const gameKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Enter', 'w', 'a', 's', 'd', 'W', 'A', 'S', 'D'];
      if (gameKeys.includes(e.key)) {
        e.preventDefault();
      }

      // Player 1 Controls (Arrows)
      if (!p1.gameOver) {
        switch (e.key) {
          case 'ArrowLeft': p1.playerMove(-1); break;
          case 'ArrowRight': p1.playerMove(1); break;
          case 'ArrowDown': p1.drop(); break;
          case 'ArrowUp': p1.playerRotate(); break;
          case 'Enter': p1.hardDrop(); break;
        }
      }

      // Player 2 Controls (WASD) - Only in Local PK
      if (mode === 'local_pk' && !p2.gameOver) {
        switch (e.key.toLowerCase()) {
          case 'a': p2.playerMove(-1); break;
          case 'd': p2.playerMove(1); break;
          case 's': p2.drop(); break;
          case 'w': p2.playerRotate(); break;
          case ' ': p2.hardDrop(); break;
        }
      }

      if (e.key.toLowerCase() === 'p') p1.setIsPaused(prev => !prev);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mode, p1, p2, countdown]);

  if (!isJoined) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center p-4 font-sans">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-[#111] border border-[#006633]/30 rounded-2xl p-8 shadow-2xl relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-[#006633]/10 blur-3xl rounded-full -mr-16 -mt-16" />
          
          <div className="text-center mb-8">
            <h1 className="text-4xl font-black text-white mb-2 tracking-tighter uppercase italic">
              hznu <span className="text-[#006633]">Python</span>
            </h1>
            <p className="text-gray-500 text-xs font-mono uppercase tracking-[0.2em]">hznu学子排行榜</p>
          </div>

          <form onSubmit={handleJoin} className="space-y-6">
            <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">学生昵称</label>
              <input
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="请输入您的昵称"
                className="w-full bg-black border border-[#333] rounded-lg px-4 py-3 text-white focus:outline-none focus:border-[#006633] transition-colors font-mono"
                required
              />
            </div>
            <button
              type="submit"
              className="w-full bg-[#006633] hover:bg-[#008844] text-white font-bold py-4 rounded-lg transition-all transform hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-[#006633]/20"
            >
              开始游戏
            </button>
          </form>
          
          <div className="mt-8 pt-6 border-t border-[#333] flex justify-between items-center">
            <button 
              onClick={() => setShowFullLeaderboard(true)}
              className="text-[10px] text-[#006633] font-bold uppercase tracking-widest hover:underline"
            >
              查看全球排行榜
            </button>
            <span className="text-[10px] text-gray-600 font-mono">v1.1.0-稳定版</span>
          </div>
        </motion.div>
      </div>
    );
  }

  if (showFullLeaderboard) {
    return (
      <div className="min-h-screen bg-[#050505] flex flex-col items-center justify-center p-4 font-sans">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-4xl bg-[#111] border border-[#006633]/30 rounded-2xl p-8 shadow-2xl relative"
        >
          <button 
            onClick={() => setShowFullLeaderboard(false)}
            className="absolute top-6 right-6 text-gray-500 hover:text-white transition-colors"
          >
            <X className="w-8 h-8" />
          </button>
          
          <div className="text-center mb-12">
            <h2 className="text-5xl font-black italic uppercase tracking-tighter mb-2">
              hznu学子 <span className="text-[#006633]">排行榜</span>
            </h2>
            <div className="h-1 w-24 bg-[#006633] mx-auto" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <Leaderboard leaderboard={leaderboard.slice(0, 5)} />
            <Leaderboard leaderboard={leaderboard.slice(5, 10)} />
          </div>

          <div className="mt-12 text-center">
            <button 
              onClick={() => setShowFullLeaderboard(false)}
              className="bg-[#006633] hover:bg-[#008844] text-white font-bold px-8 py-3 rounded-lg transition-all"
            >
              返回
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  if (isJoined && !mode) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center p-4 font-sans">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-4xl bg-[#111] border border-[#006633]/30 rounded-2xl p-12 shadow-2xl relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 w-64 h-64 bg-[#006633]/5 blur-3xl rounded-full -mr-32 -mt-32" />
          
          <div className="text-center mb-16">
            <h1 className="text-6xl font-black text-white mb-4 tracking-tighter uppercase italic">
              选择 <span className="text-[#006633]">游戏模式</span>
            </h1>
            <p className="text-gray-500 text-sm font-mono uppercase tracking-[0.3em]">欢迎回来, {nickname}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <motion.button 
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={startSingle}
              className="bg-black/50 border border-[#333] hover:border-[#006633] p-8 rounded-2xl flex flex-col items-center text-center transition-all group"
            >
              <div className="w-16 h-16 bg-[#006633]/10 rounded-full flex items-center justify-center mb-6 group-hover:bg-[#006633]/20 transition-colors">
                <Play className="w-8 h-8 text-[#006633]" />
              </div>
              <h3 className="text-2xl font-bold mb-2">单人模式</h3>
              <p className="text-gray-500 text-xs">挑战自我，刷新最高分记录</p>
            </motion.button>

            <motion.button 
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={startLocalPK}
              className="bg-black/50 border border-[#333] hover:border-blue-500 p-8 rounded-2xl flex flex-col items-center text-center transition-all group"
            >
              <div className="w-16 h-16 bg-blue-500/10 rounded-full flex items-center justify-center mb-6 group-hover:bg-blue-500/20 transition-colors">
                <LayoutGrid className="w-8 h-8 text-blue-500" />
              </div>
              <h3 className="text-2xl font-bold mb-2">本地对战</h3>
              <p className="text-gray-500 text-xs">与好友在同一台电脑上一决高下</p>
            </motion.button>

            <motion.button 
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={startOnlinePK}
              className="bg-black/50 border border-[#333] hover:border-purple-500 p-8 rounded-2xl flex flex-col items-center text-center transition-all group"
            >
              <div className="w-16 h-16 bg-purple-500/10 rounded-full flex items-center justify-center mb-6 group-hover:bg-purple-500/20 transition-colors">
                <Globe className="w-8 h-8 text-purple-500" />
              </div>
              <h3 className="text-2xl font-bold mb-2">在线对战</h3>
              <p className="text-gray-500 text-xs">随机匹配全球玩家进行实时竞技</p>
            </motion.button>
          </div>

          <div className="mt-16 pt-8 border-t border-[#333] flex justify-between items-center">
            <button 
              onClick={() => setShowFullLeaderboard(true)}
              className="flex items-center gap-2 text-sm text-[#006633] font-bold uppercase tracking-widest hover:underline"
            >
              <Trophy className="w-4 h-4" /> 查看排行榜
            </button>
            <button 
              onClick={() => setIsJoined(false)}
              className="text-sm text-gray-500 font-bold uppercase tracking-widest hover:text-white transition-colors"
            >
              退出登录
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-white p-4 md:p-8 font-sans">
      {/* Header */}
      <header className="max-w-7xl mx-auto flex justify-between items-center mb-12 border-b border-[#333] pb-6">
        <div>
          <h1 className="text-2xl font-black tracking-tighter italic uppercase cursor-pointer" onClick={() => { setMode(null); p1.resetGame(); p2.resetGame(); }}>
            hznu <span className="text-[#006633]">Python</span>
          </h1>
          <p className="text-[10px] text-gray-500 font-mono uppercase tracking-widest">当前用户: {nickname}</p>
        </div>
        
        <div className="flex gap-3">
          <button 
            onClick={() => setShowFullLeaderboard(true)}
            className="p-2 bg-[#111] border border-[#333] rounded-lg hover:border-[#006633] transition-all"
            title="全球排行榜"
          >
            <Trophy className="w-5 h-5 text-yellow-500" />
          </button>
          
          <div className="h-8 w-[1px] bg-[#333] mx-2" />

          <button 
            onClick={() => { 
              if (window.confirm('确定要切换模式吗？当前进度将丢失。')) {
                setMode(null); 
                setPkRoom(null); 
                p1.resetGame(); 
                p2.resetGame(); 
              }
            }}
            className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 px-4 py-2 rounded-lg transition-all text-sm font-bold text-red-500"
          >
            <RotateCcw className="w-4 h-4" /> 切换模式
          </button>
        </div>
      </header>

      <main className={`max-w-7xl mx-auto grid gap-8 items-start ${
        mode === 'local_pk' || (mode === 'online_pk' && opponentState)
          ? 'grid-cols-1 lg:grid-cols-2'
          : 'grid-cols-1 lg:grid-cols-[1fr_auto_1fr]'
      }`}>
        {/* Left Panel: Player 1 Stats or Player 2 Board */}
        <div className={`space-y-8 ${mode === 'local_pk' || (mode === 'online_pk' && opponentState) ? 'order-1' : 'order-2 lg:order-1'}`}>
          {mode === 'local_pk' ? (
            <div className="bg-[#111] border border-blue-500/20 rounded-xl p-6 flex flex-col items-center">
              <p className="text-[10px] font-bold text-blue-500 uppercase tracking-widest mb-4 flex items-center gap-2 self-start">
                <Keyboard className="w-3 h-3" /> 玩家 2 (WASD 控制)
              </p>
              <TetrisBoard board={p2.board} activePiece={p2.activePiece} />
              <div className="mt-6 grid grid-cols-2 gap-4 text-center w-full">
                <div>
                  <p className="text-[8px] text-gray-500 uppercase">得分</p>
                  <p className="text-2xl font-black font-mono">{p2.score.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-[8px] text-gray-500 uppercase">消除行数</p>
                  <p className="text-2xl font-black font-mono">{p2.lines}</p>
                </div>
              </div>
            </div>
          ) : (mode === 'online_pk' && opponentState) ? (
            <div className="bg-[#111] border border-red-500/20 rounded-xl p-6 flex flex-col items-center">
              <p className="text-[10px] font-bold text-red-500 uppercase tracking-widest mb-4 flex items-center gap-2 self-start">
                <Users className="w-3 h-3" /> 对手: {opponentState.nickname}
              </p>
              <TetrisBoard board={opponentState.board} activePiece={null} isOpponent />
              <div className="mt-6 grid grid-cols-2 gap-4 text-center w-full">
                <div>
                  <p className="text-[8px] text-gray-500 uppercase">得分</p>
                  <p className="text-2xl font-black font-mono">{opponentState.score.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-[8px] text-gray-500 uppercase">消除行数</p>
                  <p className="text-2xl font-black font-mono">{opponentState.lines}</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-[#111] border border-[#333] rounded-xl p-6">
              <div className="flex items-center gap-2 mb-4 text-[#006633]">
                <Zap className="w-4 h-4 fill-current" />
                <span className="text-[10px] font-bold uppercase tracking-widest">性能数据</span>
              </div>
              <div className="grid grid-cols-2 gap-8">
                <div>
                  <p className="text-gray-500 text-[10px] uppercase font-bold mb-1">得分</p>
                  <p className="text-3xl font-black font-mono">{p1.score.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-[10px] uppercase font-bold mb-1">等级</p>
                  <p className="text-3xl font-black font-mono">{p1.level}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-[10px] uppercase font-bold mb-1">消除行数</p>
                  <p className="text-3xl font-black font-mono">{p1.lines}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-[10px] uppercase font-bold mb-1">下落速度</p>
                  <p className="text-3xl font-black font-mono">{Math.round(p1.dropInterval)}ms</p>
                </div>
              </div>
              
              {mode && (
                <div className="mt-8 pt-6 border-t border-[#333] flex gap-3">
                  <button 
                    onClick={() => p1.setIsPaused(prev => !prev)}
                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-bold transition-all ${
                      p1.isPaused 
                        ? 'bg-[#006633] text-white shadow-lg shadow-[#006633]/20' 
                        : 'bg-[#1a1a1a] text-gray-400 border border-[#333] hover:border-[#006633] hover:text-white'
                    }`}
                  >
                    {p1.isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                    {p1.isPaused ? '继续' : '暂停'}
                  </button>
                </div>
              )}
            </div>
          )}

          {!mode && <Leaderboard leaderboard={leaderboard} />}
        </div>

        {/* Center Board: Player 1 */}
        <div className={`flex flex-col items-center gap-6 ${mode === 'local_pk' || (mode === 'online_pk' && opponentState) ? 'order-2' : 'order-1 lg:order-2'}`}>
          {waiting ? (
            <div className="w-[300px] h-[600px] bg-[#111] border-4 border-dashed border-[#333] rounded-lg flex items-center justify-center text-center p-8">
              <div>
                <div className="w-12 h-12 border-4 border-[#006633] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                <p className="text-sm font-bold text-gray-400 uppercase tracking-widest">正在寻找对手...</p>
              </div>
            </div>
          ) : mode ? (
            <div className="relative bg-[#111] border border-[#006633]/20 rounded-xl p-6 flex flex-col items-center">
              <div className="text-[10px] font-bold text-[#006633] uppercase tracking-widest mb-4 self-start">
                {mode === 'local_pk' ? '玩家 1' : nickname}
              </div>
              <TetrisBoard board={p1.board} activePiece={p1.activePiece} />
              
              <div className="mt-6 grid grid-cols-2 gap-4 text-center w-full">
                <div>
                  <p className="text-[8px] text-gray-500 uppercase">得分</p>
                  <p className="text-2xl font-black font-mono">{p1.score.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-[8px] text-gray-500 uppercase">消除行数</p>
                  <p className="text-2xl font-black font-mono">{p1.lines}</p>
                </div>
              </div>
              <AnimatePresence>
                {countdown !== null && (
                  <motion.div
                    initial={{ scale: 0, opacity: 0, rotate: -180 }}
                    animate={{ scale: 1, opacity: 1, rotate: 0 }}
                    exit={{ scale: 5, opacity: 0 }}
                    className="absolute inset-0 flex items-center justify-center z-30 pointer-events-none bg-black/20 backdrop-blur-[2px]"
                  >
                    <div className="relative">
                      <motion.div
                        animate={{ 
                          scale: [1, 1.5, 1],
                          opacity: [0.2, 0.5, 0.2]
                        }}
                        transition={{ repeat: Infinity, duration: 0.5 }}
                        className="absolute inset-0 bg-[#006633] blur-[60px] rounded-full"
                      />
                      <span className="text-9xl font-black italic text-white drop-shadow-[0_0_40px_rgba(0,102,51,1)] relative z-10">
                        {countdown === 0 ? '开始!' : countdown}
                      </span>
                    </div>
                  </motion.div>
                )}
                {(p1.gameOver || (mode === 'local_pk' && p2.gameOver) || p1.isPaused) && countdown === null && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center text-center p-8 rounded-lg z-10"
                  >
                    {p1.gameOver ? (
                      <div className="w-full">
                        <Trophy className="w-16 h-16 text-yellow-500 mx-auto mb-4 animate-bounce" />
                        <h2 className="text-4xl font-black text-red-500 mb-2 uppercase italic">游戏结束</h2>
                        <p className="text-gray-400 mb-8 font-mono">最终得分: {p1.score}</p>
                        <div className="flex flex-col gap-3 max-w-[200px] mx-auto">
                          <button 
                            onClick={() => { p1.resetGame(); p2.resetGame(); }}
                            className="flex items-center justify-center gap-2 bg-[#006633] hover:bg-[#008844] px-6 py-3 rounded-lg font-bold transition-all"
                          >
                            <RotateCcw className="w-4 h-4" /> 再试一次
                          </button>
                          <button 
                            onClick={() => { setMode(null); setPkRoom(null); p1.resetGame(); p2.resetGame(); }}
                            className="flex items-center justify-center gap-2 bg-[#111] border border-[#333] hover:border-[#006633] px-6 py-3 rounded-lg font-bold transition-all"
                          >
                            <Monitor className="w-4 h-4" /> 返回主页
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <h2 className="text-4xl font-black text-white mb-8 uppercase italic">已暂停</h2>
                        <button 
                          onClick={() => p1.setIsPaused(false)}
                          className="flex items-center gap-2 bg-[#006633] px-6 py-3 rounded-lg font-bold mx-auto"
                        >
                          <Play className="w-4 h-4" /> 继续
                        </button>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : (
            <div className="w-[300px] h-[600px] bg-[#111] border-4 border-[#333] rounded-lg flex items-center justify-center text-center p-8">
              <div>
                <Trophy className="w-12 h-12 text-[#006633] mx-auto mb-4 opacity-20" />
                <p className="text-sm font-bold text-gray-600 uppercase tracking-widest">请选择游戏模式开始</p>
              </div>
            </div>
          )}
        </div>

        {/* Right Panel: Opponent Board or Leaderboard */}
        <div className="space-y-8 order-3 flex flex-col items-center lg:items-stretch">
          {mode === 'online_pk' && opponentState && (
            <div className="bg-[#111] border border-red-500/20 rounded-xl p-4 flex flex-col items-center w-full max-w-[300px] lg:max-w-none">
              <p className="text-[10px] font-bold text-red-500 uppercase tracking-widest mb-4 flex items-center gap-2 self-start">
                <Users className="w-3 h-3" /> 对手: {opponentState.nickname}
              </p>
              <TetrisBoard board={opponentState.board} activePiece={null} isOpponent />
              <div className="mt-4 grid grid-cols-2 gap-4 text-center w-full">
                <div>
                  <p className="text-[8px] text-gray-500 uppercase">得分</p>
                  <p className="text-lg font-bold font-mono">{opponentState.score}</p>
                </div>
                <div>
                  <p className="text-[8px] text-gray-500 uppercase">消除行数</p>
                  <p className="text-lg font-bold font-mono">{opponentState.lines}</p>
                </div>
              </div>
            </div>
          )}
          
          <Leaderboard leaderboard={leaderboard} />
        </div>
      </main>

      {/* Standalone Leaderboard Modal (Duplicate for access within game) */}
      <AnimatePresence>
        {showFullLeaderboard && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/95 backdrop-blur-xl flex items-center justify-center p-4"
          >
            <div className="w-full max-w-2xl relative">
              <button 
                onClick={() => setShowFullLeaderboard(false)}
                className="absolute -top-12 right-0 text-white hover:text-[#006633] transition-colors"
              >
                <X className="w-8 h-8" />
              </button>
              <div className="text-center mb-12">
                <h2 className="text-5xl font-black italic uppercase tracking-tighter mb-2">
                  hznu学子 <span className="text-[#006633]">排行榜</span>
                </h2>
                <div className="h-1 w-24 bg-[#006633] mx-auto" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <Leaderboard leaderboard={leaderboard.slice(0, 5)} />
                <Leaderboard leaderboard={leaderboard.slice(5, 10)} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <footer className="max-w-7xl mx-auto mt-24 pt-8 border-t border-[#333] flex justify-between items-center opacity-50">
        <p className="text-[10px] font-mono">© 2026 hznu Python 课程 - 计算机学院</p>
        <div className="flex gap-6 text-[10px] font-bold uppercase tracking-widest">
          <span>隐私政策</span>
          <span>服务条款</span>
          <span>技术支持</span>
        </div>
      </footer>
    </div>
  );
}
