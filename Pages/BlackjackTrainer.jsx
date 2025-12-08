import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Undo,
  RotateCcw,
  TrendingUp,
  AlertCircle,
  Check,
  X,
  Moon,
  Sun,
  Zap,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  Info
} from 'lucide-react';
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DEFAULT_COMPREHENSIVE_RULES, calculateBaseHouseEdge, calculateCountAdjustedEV, recommendBetUnits } from '../components/blackjack/RulesEngine';
import { getCountingSystem, calculateTrueCount } from '../components/blackjack/CountingSystems';
import { generateStrategyResponse } from '../components/blackjack/StrategyEngine';
import AdvancedRulesPanel from '../components/blackjack/AdvancedRulesPanel';

// Rules and EV calculations now handled by RulesEngine and StrategyEngine modules

// Simplified FAQ for UI
const RULE_INFO = {
  numDecks: "Number of decks in the shoe. Fewer decks make counting easier but usually worse rules.",
  penetration: "How deep into the shoe before shuffle. Higher penetration = more profitable counting.",
  dealerHitsSoft17: "H17 = Dealer hits soft 17 (A+6). Worse for player (−0.20%). S17 = Dealer stands.",
  blackjackPays: "3:2 is standard. 6:5 is very bad (−1.45%). 2:1 is extremely rare but excellent (+2.30%).",
  enhc: "European No Hole Card. Dealer doesn't check for blackjack immediately. Risk losing double/split bets (−0.10%).",
  das: "Double After Split. Ability to double after splitting. Good for player (+0.14% when enabled).",
  lateSurrender: "Surrender after dealer checks for blackjack. Get half bet back. Good for bad hands (+0.07%).",
  earlySurrender: "Surrender before dealer checks blackjack. Very advantageous but extremely rare (+0.62%).",
  insurance: "Side bet when dealer shows ace. Only take at TC ≥ +3 when counting.",
  resplitAces: "Ability to resplit aces if you get another ace. Slightly advantageous (+0.03%).",
  hitSplitAces: "Take multiple cards on split aces (usually only get one card). Good for player (+0.03%)."
};

const FAQ_DATA = [
  {
    question: "What is Running Count (RC)?",
    answer: "The sum of plus/minus based on which cards have been dealt. High cards (10, J, Q, K, A) = -1, Low cards (2-6) = +1, Neutral (7-9) = 0."
  },
  {
    question: "What is True Count (TC)?",
    answer: "Running Count divided by decks remaining. TC is used for decisions and bet sizing. Higher TC = greater advantage for player."
  },
  {
    question: "What is EV (% edge)?",
    answer: "Your long-term expected profit/loss per bet. Positive EV = player advantage, negative = house advantage."
  },
  {
    question: "What is ENHC (No Hole Card)?",
    answer: "Dealer doesn't take a hole card immediately, meaning you can lose extra bets (splits/doubles) if dealer gets blackjack."
  },
  {
    question: "Why is 6:5 bad?",
    answer: "You get paid less for blackjack (1.2x instead of 1.5x), which drastically lowers your long-term win rate (−1.45% EV)."
  },
  {
    question: "What is Wonging?",
    answer: "Only playing when TC is positive (e.g. ≥ +1 or +2), otherwise sitting out shoes/hands. Reduces risk and increases expected profit."
  }
];

const InfoTooltip = ({ text }) => (
  <TooltipProvider delayDuration={100}>
    <Tooltip>
      <TooltipTrigger asChild>
        <Info className="w-4 h-4 text-slate-400 hover:text-blue-600 cursor-help transition-colors" />
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <p className="text-sm">{text}</p>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

export default function BlackjackTrainer() {
  const [rules, setRules] = useState(DEFAULT_COMPREHENSIVE_RULES);
  const [showRulesPanel, setShowRulesPanel] = useState(false);
  const [showFAQ, setShowFAQ] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [runningCount, setRunningCount] = useState(0);
  const [cardsRemaining, setCardsRemaining] = useState({});
  const [history, setHistory] = useState([]);
  const [quickInput, setQuickInput] = useState('');
  
  const [handType, setHandType] = useState('hard');
  const [handValue, setHandValue] = useState('16');
  const [dealerCard, setDealerCard] = useState('10');
  const [recommendation, setRecommendation] = useState(null);
  const [jsonResponse, setJsonResponse] = useState(null);

  useEffect(() => {
    const savedTheme = localStorage.getItem('blackjack-theme');
    if (savedTheme === 'dark') {
      setDarkMode(true);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('blackjack-theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  useEffect(() => {
    resetShoe();
  }, [rules.numDecks]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowLeft') { // Changed from ArrowRight
        e.preventDefault();
        applyQuickCount(1);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        applyQuickCount(0);
      } else if (e.key === 'ArrowRight') { // Changed from ArrowLeft
        e.preventDefault();
        applyQuickCount(-1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cardsRemaining, runningCount, history]); // Dependencies needed for `applyQuickCount` to use latest state

  const resetShoe = () => {
    const initialCards = {};
    ['2','3','4','5','6','7','8','9'].forEach(card => {
      initialCards[card] = rules.numDecks * 4;
    });
    initialCards['10'] = rules.numDecks * 16;
    initialCards['A'] = rules.numDecks * 4;
    
    setCardsRemaining(initialCards);
    setRunningCount(0);
    setHistory([]);
    setRecommendation(null);
  };

  const quickStartStandard = () => {
    setRules(DEFAULT_RULES);
    resetShoe();
  };

  const getTotalCardsRemaining = () => {
    return Object.values(cardsRemaining).reduce((sum, count) => sum + count, 0);
  };

  const getRemainingDecks = () => {
    return getTotalCardsRemaining() / 52;
  };

  const getTrueCount = () => {
    const remaining = getRemainingDecks();
    return remaining > 0 ? runningCount / remaining : 0;
  };

  const getTrueCountRounded = () => {
    return Math.round(getTrueCount());
  };

  // Calculate remaining cards by category with percentages
  const getCardsRemainingByCategory = () => {
    const plusOneCards = ['2','3','4','5','6'].reduce((sum, card) => sum + (cardsRemaining[card] || 0), 0);
    const neutralCards = ['7','8','9'].reduce((sum, card) => sum + (cardsRemaining[card] || 0), 0);
    const minusOneCards = (cardsRemaining['10'] || 0) + (cardsRemaining['A'] || 0);
    
    const totalCards = getTotalCardsRemaining();
    
    return {
      plusOne: plusOneCards,
      plusOnePercent: totalCards > 0 ? ((plusOneCards / totalCards) * 100).toFixed(1) : '0.0',
      neutral: neutralCards,
      neutralPercent: totalCards > 0 ? ((neutralCards / totalCards) * 100).toFixed(1) : '0.0',
      minusOne: minusOneCards,
      minusOnePercent: totalCards > 0 ? ((minusOneCards / totalCards) * 100).toFixed(1) : '0.0'
    };
  };

  const applyCard = (card) => {
    if (cardsRemaining[card] <= 0) return;
    const countingSystem = getCountingSystem(rules.countingSystem);
    const weight = countingSystem.tags[card] || 0;
    const newRemaining = { ...cardsRemaining, [card]: cardsRemaining[card] - 1 };
    const newRC = runningCount + weight;
    
    setHistory([...history, { card, weight, rc: runningCount, remaining: cardsRemaining }]);
    setCardsRemaining(newRemaining);
    setRunningCount(newRC);
  };

  const removeCard = (card) => {
    const maxCards = card === '10' ? rules.numDecks * 16 : rules.numDecks * 4;
    if (cardsRemaining[card] >= maxCards) return;
    
    const countingSystem = getCountingSystem(rules.countingSystem);
    const weight = countingSystem.tags[card] || 0;
    const newRemaining = { ...cardsRemaining, [card]: cardsRemaining[card] + 1 };
    const newRC = runningCount - weight;
    
    setCardsRemaining(newRemaining);
    setRunningCount(newRC);
  };

  const applyQuickCount = (value) => {
    if (getTotalCardsRemaining() <= 0) return;
    
    let cardToRemove = null;
    const cardsCopy = { ...cardsRemaining };
    
    // Find a card from the correct category based on the button clicked
    if (value === 1) {
      // +1 button: remove a low card (2-6)
      const lowCards = ['2', '3', '4', '5', '6'];
      for (let card of lowCards) {
        if (cardsCopy[card] > 0) {
          cardToRemove = card;
          break;
        }
      }
    } else if (value === 0) {
      // 0 button: remove a neutral card (7-9)
      const neutralCards = ['7', '8', '9'];
      for (let card of neutralCards) {
        if (cardsCopy[card] > 0) {
          cardToRemove = card;
          break;
        }
      }
    } else if (value === -1) {
      // -1 button: remove a high card (10, A)
      if (cardsCopy['10'] > 0) {
        cardToRemove = '10';
      } else if (cardsCopy['A'] > 0) {
        cardToRemove = 'A';
      }
    }
    
    // If we found a card to remove, apply it
    if (cardToRemove) {
      cardsCopy[cardToRemove]--;
      const newRC = runningCount + value;
      
      setHistory([...history, { quick: value, card: cardToRemove, rc: runningCount, remaining: cardsRemaining }]);
      setCardsRemaining(cardsCopy);
      setRunningCount(newRC);
    }
  };

  const undo = () => {
    if (history.length === 0) return;
    const lastAction = history[history.length - 1];
    setRunningCount(lastAction.rc);
    setCardsRemaining(lastAction.remaining);
    setHistory(history.slice(0, -1));
  };

  const processQuickInput = () => {
    const cards = quickInput.toUpperCase().split(',').map(c => c.trim());
    const countingSystem = getCountingSystem(rules.countingSystem);
    cards.forEach(card => {
      const normalizedCard = ['J', 'Q', 'K'].includes(card) ? '10' : card;
      if (countingSystem.tags[normalizedCard] !== undefined && cardsRemaining[normalizedCard] > 0) {
        applyCard(normalizedCard);
      }
    });
    setQuickInput('');
  };

  // Now using comprehensive strategy engine
  const getRecommendation = () => {
    const decksRemaining = getRemainingDecks();
    const trueCount = calculateTrueCount(runningCount, decksRemaining, rules.countingSystem);
    
    const response = generateStrategyResponse(
      handType,
      handValue,
      dealerCard,
      trueCount,
      rules
    );
    
    setRecommendation(response);
    setJsonResponse(JSON.stringify(response, null, 2));
  };

  // Legacy function kept for compatibility
  const getBasicStrategyActionLegacy = (handType, handValue, dealer, rules) => {
    if (handType === 'hard') {
      const v = parseInt(handValue);
      if (v >= 17) return 'Stand';
      if (v === 16) return [2,3,4,5,6].includes(dealer) ? 'Stand' : 'Hit';
      if (v === 15) return [2,3,4,5,6].includes(dealer) ? 'Stand' : 'Hit';
      if (v === 14) return [2,3,4,5,6].includes(dealer) ? 'Stand' : 'Hit';
      if (v === 13) return [2,3,4,5,6].includes(dealer) ? 'Stand' : 'Hit';
      if (v === 12) return [4,5,6].includes(dealer) ? 'Stand' : 'Hit';
      if (v === 11) return 'Double';
      if (v === 10) return [2,3,4,5,6,7,8,9].includes(dealer) ? 'Double' : 'Hit';
      if (v === 9) return [3,4,5,6].includes(dealer) ? 'Double' : 'Hit';
      return 'Hit';
    } else if (handType === 'soft') {
      const v = parseInt(handValue);
      if (v === 9) return 'Stand';
      if (v === 8) return [2,3,4,5,6].includes(dealer) ? 'Double' : 'Stand';
      if (v === 7) return [3,4,5,6].includes(dealer) ? 'Double' : [2,7,8].includes(dealer) ? 'Stand' : 'Hit';
      if (v === 6) return [3,4,5,6].includes(dealer) ? 'Double' : 'Hit';
      if (v === 5 || v === 4) return [4,5,6].includes(dealer) ? 'Double' : 'Hit';
      if (v === 3 || v === 2) return [5,6].includes(dealer) ? 'Double' : 'Hit';
    } else if (handType === 'pairs') {
      if (handValue === 'A') return 'Split';
      if (handValue === '10') return 'Stand';
      if (handValue === '9') return [2,3,4,5,6,8,9].includes(dealer) ? 'Split' : 'Stand';
      if (handValue === '8') return 'Split';
      if (handValue === '7') return [2,3,4,5,6,7].includes(dealer) ? 'Split' : 'Hit';
      if (handValue === '6') return [2,3,4,5,6].includes(dealer) ? (rules.das ? 'Split' : 'Hit') : 'Hit';
      if (handValue === '5') return 'Double';
      if (handValue === '4') return [5,6].includes(dealer) && rules.das ? 'Split' : 'Hit';
      if (handValue === '3' || handValue === '2') return [2,3,4,5,6,7].includes(dealer) && rules.das ? 'Split' : 'Hit';
    }
    return 'Hit';
  };

  const getRecommendationLegacy = () => {
    const dealer = dealerCard === 'A' ? 11 : parseInt(dealerCard);
    const tc = getTrueCountRounded();
    let action = '';
    let note = 'Basic Strategy';
    
    if (dealer === 11 && rules.insurance && tc >= 3) {
      setRecommendation({
        action: 'Insurance',
        note: `TC = ${tc >= 0 ? '+' : ''}${tc} → Take insurance (TC ≥ +3)`,
        ev: calculateEV(tc, rules),
        color: 'purple'
      });
      return;
    }

    if (rules.lateSurrender) {
      const v = parseInt(handValue);
      if (handType === 'hard') {
        if ((v === 16 && [9,10,11].includes(dealer)) || (v === 15 && dealer === 10)) {
          action = 'Surrender';
          note = 'Late Surrender';
        }
      }
    }

    if (!action) {
      const handKey = `${handType}-${handValue}`;
      
      if (handKey === 'hard-16' && dealer === 10 && tc >= 0) {
        action = 'Stand';
        note = `Index 0 → Stand (TC = ${tc >= 0 ? '+' : ''}${tc})`;
      } else if (handKey === 'hard-15' && dealer === 10 && tc >= 4) {
        action = 'Stand';
        note = `Index +4 → Stand (TC = ${tc >= 0 ? '+' : ''}${tc})`;
      } else if (handKey === 'hard-12' && dealer === 3 && tc >= 2) {
        action = 'Stand';
        note = `Index +2 → Stand (TC = ${tc >= 0 ? '+' : ''}${tc})`;
      } else if (handKey === 'hard-12' && dealer === 2 && tc >= 3) {
        action = 'Stand';
        note = `Index +3 → Stand (TC = ${tc >= 0 ? '+' : ''}${tc})`;
      } else if (handKey === 'hard-10' && (dealer === 10 || dealer === 11) && tc >= 4) {
        action = 'Double';
        note = `Index +4 → Double (TC = ${tc >= 0 ? '+' : ''}${tc})`;
      } else if (handKey === 'hard-11' && dealer === 11 && tc >= 1) {
        action = 'Double';
        note = `Index +1 → Double (TC = ${tc >= 0 ? '+' : ''}${tc})`;
      } else if (handKey === 'hard-9' && dealer === 2 && tc >= 1) {
        action = 'Double';
        note = `Index +1 → Double (TC = ${tc >= 0 ? '+' : ''}${tc})`;
      } else if (handKey === 'hard-9' && dealer === 7 && tc >= 3) {
        action = 'Double';
        note = `Index +3 → Double (TC = ${tc >= 0 ? '+' : ''}${tc})`;
      } else if (handKey === 'soft-8' && dealer === 6 && tc >= 3) {
        action = 'Double';
        note = `Index +3 → Double (TC = ${tc >= 0 ? '+' : ''}${tc})`;
      } else if (handKey === 'pairs-9' && dealer === 7 && tc >= 3) {
        action = 'Split';
        note = `Index +3 → Split (TC = ${tc >= 0 ? '+' : ''}${tc})`;
      }
    }

    if (!action) {
      action = getBasicStrategyActionLegacy(handType, handValue, dealer, rules);
    }

    const actionColors = {
      'Stand': 'green',
      'Hit': 'red',
      'Double': 'yellow',
      'Split': 'blue',
      'Insurance': 'purple',
      'Surrender': 'orange'
    };

    setRecommendation({
      action,
      note,
      ev: calculateEV(tc, rules),
      color: actionColors[action] || 'gray'
    });
  };

  // EV calculations now handled by RulesEngine

  const getCountColor = (tc) => {
    if (darkMode) {
      if (tc > 0) return 'text-green-400 bg-green-950 border-green-800';
      if (tc < 0) return 'text-red-400 bg-red-950 border-red-800';
      return 'text-yellow-400 bg-yellow-950 border-yellow-800';
    }
    if (tc > 0) return 'text-green-600 bg-green-50 border-green-200';
    if (tc < 0) return 'text-red-600 bg-red-50 border-red-200';
    return 'text-yellow-600 bg-yellow-50 border-yellow-200';
  };

  const getEVColor = (ev) => {
    if (darkMode) {
      if (ev >= 0.25) return 'bg-green-950 text-green-400 border-green-800';
      if (ev <= -0.25) return 'bg-red-950 text-red-400 border-red-800';
      return 'bg-yellow-950 text-yellow-400 border-yellow-800';
    }
    if (ev >= 0.25) return 'bg-green-100 text-green-800 border-green-300';
    if (ev <= -0.25) return 'bg-red-100 text-red-800 border-red-300';
    return 'bg-yellow-100 text-yellow-800 border-yellow-300';
  };

  const decksRemaining = getRemainingDecks();
  const tc = calculateTrueCount(runningCount, decksRemaining, rules.countingSystem);
  const tcRounded = Math.round(tc);
  const cardsByCategory = getCardsRemainingByCategory();
  const baseHouseEdge = calculateBaseHouseEdge(rules);
  const countAdjustedEV = calculateCountAdjustedEV(baseHouseEdge, tc, rules);
  const betUnits = recommendBetUnits(tc, rules);

  return (
    <div className={cn(
      "min-h-screen p-3 md:p-6 transition-colors duration-300",
      darkMode 
        ? "bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900" 
        : "bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100"
    )}>
      <div className="max-w-7xl mx-auto space-y-4">
        
        {/* Header with Theme Toggle */}
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center py-4 relative"
        >
          <h1 className={cn(
            "text-3xl md:text-4xl font-bold mb-2",
            darkMode ? "text-white" : "text-slate-900"
          )}>
            Blackjack Pro Analyzer
          </h1>
          <p className={cn(
            "text-sm md:text-base",
            darkMode ? "text-slate-400" : "text-slate-600"
          )}>
            Hi-Lo System • {rules.dealerHitsSoft17 ? 'H17' : 'S17'} • 
            {rules.das ? ' DAS' : ' No DAS'} • 
            {rules.blackjackPays === 1.5 ? ' 3:2' : rules.blackjackPays === 1.2 ? ' 6:5' : ' 2:1'}
          </p>
          
          <Button
            variant="outline"
            size="icon"
            onClick={() => setDarkMode(!darkMode)}
            className={cn(
              "absolute top-0 right-0 md:top-4 md:right-4",
              darkMode 
                ? "bg-slate-800 border-slate-700 hover:bg-slate-700" 
                : "bg-white border-slate-200 hover:bg-slate-100"
            )}
          >
            {darkMode ? (
              <Sun className="w-5 h-5 text-yellow-400" />
            ) : (
              <Moon className="w-5 h-5 text-slate-700" />
            )}
          </Button>
        </motion.div>

        {/* Quick Start */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex justify-center"
        >
          <Button
            onClick={quickStartStandard}
            className={cn(
              "gap-2 shadow-lg",
              darkMode
                ? "bg-blue-600 hover:bg-blue-700 text-white"
                : "bg-blue-600 hover:bg-blue-700 text-white"
            )}
          >
            <Zap className="w-4 h-4" />
            Quick Start: Standard Vegas 6D (S17, DAS, 3:2)
          </Button>
        </motion.div>

        {/* COMBINED MAIN PLAY AREA - Count + Strategy in ONE view */}
        <Card className={cn(
          "shadow-lg border-2",
          darkMode 
            ? "bg-slate-800 border-slate-700" 
            : "bg-white border-slate-200"
        )}>
          <CardHeader className="pb-3">
            <CardTitle className={cn(
              "text-lg md:text-xl text-center",
              darkMode ? "text-white" : "text-slate-900"
            )}>
              🎯 Card Counter & Strategy
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            
            {/* Stats Info at TOP */}
            <div className={cn(
              "flex justify-around p-2.5 rounded-lg border-2 text-sm",
              darkMode 
                ? "bg-slate-900 border-slate-700" 
                : "bg-slate-50 border-slate-200"
            )}>
              <div className="text-center">
                <div className={cn(
                  "text-xs mb-0.5",
                  darkMode ? "text-slate-500" : "text-slate-600"
                )}>
                  Cards Left
                </div>
                <div className={cn(
                  "text-xl font-bold",
                  darkMode ? "text-white" : "text-slate-900"
                )}>
                  {getTotalCardsRemaining()}
                </div>
              </div>
              <div className="text-center">
                <div className={cn(
                  "text-xs mb-0.5",
                  darkMode ? "text-slate-500" : "text-slate-600"
                )}>
                  Decks Left
                </div>
                <div className={cn(
                  "text-xl font-bold",
                  darkMode ? "text-white" : "text-slate-900"
                )}>
                  {getRemainingDecks().toFixed(1)}
                </div>
              </div>
            </div>

            {/* Count Display */}
            <div className="grid grid-cols-2 gap-3">
              <div className="text-center">
                <div className={cn(
                  "text-xs mb-1 font-medium",
                  darkMode ? "text-slate-400" : "text-slate-600"
                )}>
                  RC
                </div>
                <motion.div 
                  key={runningCount}
                  initial={{ scale: 1.05 }}
                  animate={{ scale: 1 }}
                  className={cn(
                    "text-3xl font-bold py-2 rounded-xl border-2",
                    getCountColor(runningCount)
                  )}
                >
                  {runningCount >= 0 ? '+' : ''}{runningCount}
                </motion.div>
              </div>
              
              <div className="text-center">
                <div className={cn(
                  "text-xs mb-1 font-medium",
                  darkMode ? "text-slate-400" : "text-slate-600"
                )}>
                  TC
                </div>
                <motion.div 
                  key={tc}
                  initial={{ scale: 1.05 }}
                  animate={{ scale: 1 }}
                  className={cn(
                    "text-3xl font-bold py-2 rounded-xl border-2",
                    getCountColor(tc)
                  )}
                >
                  {tc >= 0 ? '+' : ''}{tc.toFixed(1)}
                </motion.div>
              </div>
            </div>

            {/* Quick Count Buttons with Card Counts and Percentages */}
            <div className="grid grid-cols-3 gap-2">
              <div className="text-center">
                <Button 
                  onClick={() => applyQuickCount(1)} 
                  className="w-full bg-green-600 hover:bg-green-700 text-white h-14 text-xl font-bold shadow-lg"
                  disabled={cardsByCategory.plusOne === 0}
                >
                  +1
                </Button>
                <div className={cn(
                  "mt-1 text-xs font-bold",
                  darkMode ? "text-green-400" : "text-green-600"
                )}>
                  {cardsByCategory.plusOne} cards ({cardsByCategory.plusOnePercent}%)
                </div>
                <div className={cn(
                  "text-xs opacity-70",
                  darkMode ? "text-slate-500" : "text-slate-600"
                )}>
                  (2-6)
                </div>
              </div>

              <div className="text-center">
                <Button 
                  onClick={() => applyQuickCount(0)} 
                  className="w-full bg-yellow-600 hover:bg-yellow-700 text-white h-14 text-xl font-bold shadow-lg"
                  disabled={cardsByCategory.neutral === 0}
                >
                  0
                </Button>
                <div className={cn(
                  "mt-1 text-xs font-bold",
                  darkMode ? "text-yellow-400" : "text-yellow-600"
                )}>
                  {cardsByCategory.neutral} cards ({cardsByCategory.neutralPercent}%)
                </div>
                <div className={cn(
                  "text-xs opacity-70",
                  darkMode ? "text-slate-500" : "text-slate-600"
                )}>
                  (7-9)
                </div>
              </div>

              <div className="text-center">
                <Button 
                  onClick={() => applyQuickCount(-1)} 
                  className="w-full bg-red-600 hover:bg-red-700 text-white h-14 text-xl font-bold shadow-lg"
                  disabled={cardsByCategory.minusOne === 0}
                >
                  −1
                </Button>
                <div className={cn(
                  "mt-1 text-xs font-bold",
                  darkMode ? "text-red-400" : "text-red-600"
                )}>
                  {cardsByCategory.minusOne} cards ({cardsByCategory.minusOnePercent}%)
                </div>
                <div className={cn(
                  "text-xs opacity-70",
                  darkMode ? "text-slate-500" : "text-slate-600"
                )}>
                  (10, A)
                </div>
              </div>
            </div>

            <Separator className={darkMode ? "bg-slate-700" : "bg-slate-200"} />

            {/* Strategy Input - COMPACT */}
            <div>
              <label className={cn(
                "text-xs mb-1.5 block font-medium",
                darkMode ? "text-slate-300" : "text-slate-600"
              )}>
                Your Hand
              </label>
              
              <div className={cn(
                "mb-2 p-3 rounded-lg border",
                darkMode 
                  ? "bg-slate-900 border-slate-700" 
                  : "bg-slate-50 border-slate-200"
              )}>
                <div className={cn(
                  "text-xs font-semibold mb-2",
                  darkMode ? "text-slate-400" : "text-slate-700"
                )}>
                  HARD
                </div>
                <div className="flex flex-wrap gap-2">
                  {[4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20].map(v => (
                    <Badge
                      key={v}
                      onClick={() => { setHandType('hard'); setHandValue(v.toString()); }}
                      className={cn(
                        "cursor-pointer px-3 py-1.5 text-sm font-bold hover:opacity-80 transition-all rounded-md",
                        handType === 'hard' && handValue === v.toString()
                          ? "bg-blue-600 text-white border-2 border-blue-700" 
                          : darkMode
                            ? "bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-600"
                            : "bg-white text-slate-700 hover:bg-slate-100 border border-slate-300"
                      )}
                    >
                      {v}
                    </Badge>
                  ))}
                </div>
              </div>
              
              <div className={cn(
                "mb-2 p-3 rounded-lg border",
                darkMode 
                  ? "bg-slate-900 border-slate-700" 
                  : "bg-slate-50 border-slate-200"
              )}>
                <div className={cn(
                  "text-xs font-semibold mb-2",
                  darkMode ? "text-slate-400" : "text-slate-700"
                )}>
                  SOFT
                </div>
                <div className="flex flex-wrap gap-2">
                  {[2,3,4,5,6,7,8,9].map(v => (
                    <Badge
                      key={v}
                      onClick={() => { setHandType('soft'); setHandValue(v.toString()); }}
                      className={cn(
                        "cursor-pointer px-3 py-1.5 text-sm font-bold hover:opacity-80 transition-all rounded-md",
                        handType === 'soft' && handValue === v.toString()
                          ? "bg-blue-600 text-white border-2 border-blue-700" 
                          : darkMode
                            ? "bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-600"
                            : "bg-white text-slate-700 hover:bg-slate-100 border border-slate-300"
                      )}
                    >
                      A,{v}
                    </Badge>
                  ))}
                </div>
              </div>
              
              <div className={cn(
                "p-3 rounded-lg border",
                darkMode 
                  ? "bg-slate-900 border-slate-700" 
                  : "bg-slate-50 border-slate-200"
              )}>
                <div className={cn(
                  "text-xs font-semibold mb-2",
                  darkMode ? "text-slate-400" : "text-slate-700"
                )}>
                  PAR
                </div>
                <div className="flex flex-wrap gap-2">
                  {['2','3','4','5','6','7','8','9','10','A'].map(v => (
                    <Badge
                      key={v}
                      onClick={() => { setHandType('pairs'); setHandValue(v); }}
                      className={cn(
                        "cursor-pointer px-3 py-1.5 text-sm font-bold hover:opacity-80 transition-all rounded-md",
                        handType === 'pairs' && handValue === v
                          ? "bg-blue-600 text-white border-2 border-blue-700" 
                          : darkMode
                            ? "bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-600"
                            : "bg-white text-slate-700 hover:bg-slate-100 border border-slate-300"
                      )}
                    >
                      {v},{v}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>

            {/* Dealer Card */}
            <div>
              <label className={cn(
                "text-xs mb-1.5 block font-medium",
                darkMode ? "text-slate-300" : "text-slate-600"
              )}>
                Dealer Upcard
              </label>
              <div className="flex flex-wrap gap-1.5">
                {['2','3','4','5','6','7','8','9','10','A'].map(v => (
                  <Badge
                    key={v}
                    onClick={() => setDealerCard(v)}
                    className={cn(
                      "cursor-pointer px-3 py-1 text-base font-bold hover:opacity-80 transition-all rounded-lg",
                      dealerCard === v 
                        ? ['10','A'].includes(v) 
                          ? darkMode
                            ? "bg-slate-900 text-white border-2 border-slate-700"
                            : "bg-slate-800 text-white border-2 border-slate-900"
                          : "bg-red-600 text-white border-2 border-red-700"
                        : darkMode
                          ? "bg-slate-700 text-slate-300 hover:bg-slate-600 border border-slate-600"
                          : "bg-slate-200 text-slate-700 hover:bg-slate-300 border border-slate-300"
                    )}
                  >
                    {v}
                  </Badge>
                ))}
              </div>
            </div>
            
            <Button 
              onClick={getRecommendation} 
              className="w-full bg-green-600 hover:bg-green-700 h-12 text-lg font-bold shadow-lg"
            >
              ⚡ Recommend Action
            </Button>
            
            {/* Recommendation Display */}
            <AnimatePresence>
              {recommendation && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, y: -20 }}
                  className={cn(
                    "p-4 rounded-xl border-2 shadow-lg space-y-3",
                    darkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-300'
                  )}
                >
                  <div className="text-center">
                    <div className={cn(
                      "text-3xl font-bold mb-2",
                      darkMode ? "text-white" : "text-slate-900"
                    )}>
                      {recommendation.recommended_action === 'stand' && '✋ Stand'}
                      {recommendation.recommended_action === 'hit' && '👊 Hit'}
                      {recommendation.recommended_action === 'double' && '💰 Double'}
                      {recommendation.recommended_action === 'split' && '✂️ Split'}
                      {recommendation.recommended_action === 'surrender' && '🏳️ Surrender'}
                      {!['stand', 'hit', 'double', 'split', 'surrender'].includes(recommendation.recommended_action) && recommendation.recommended_action}
                    </div>
                    {recommendation.take_insurance && (
                      <Badge className="bg-purple-600 text-white mb-2">
                        🛡️ Take Insurance
                      </Badge>
                    )}
                  </div>
                  
                  <div className={cn(
                    "text-sm p-3 rounded-lg border",
                    darkMode ? "bg-slate-800 border-slate-700 text-slate-300" : "bg-slate-50 border-slate-200 text-slate-700"
                  )}>
                    {recommendation.reasoning}
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className={cn(
                      "p-2 rounded border text-center",
                      darkMode ? "bg-slate-800 border-slate-700" : "bg-slate-50 border-slate-200"
                    )}>
                      <div className={cn("font-medium", darkMode ? "text-slate-400" : "text-slate-600")}>
                        Count-Adjusted EV
                      </div>
                      <div className={cn(
                        "text-lg font-bold",
                        recommendation.count_adjusted_ev >= 0 
                          ? (darkMode ? "text-green-400" : "text-green-600")
                          : (darkMode ? "text-red-400" : "text-red-600")
                      )}>
                        {recommendation.count_adjusted_ev >= 0 ? '+' : ''}{recommendation.count_adjusted_ev}%
                      </div>
                    </div>
                    <div className={cn(
                      "p-2 rounded border text-center",
                      darkMode ? "bg-slate-800 border-slate-700" : "bg-slate-50 border-slate-200"
                    )}>
                      <div className={cn("font-medium", darkMode ? "text-slate-400" : "text-slate-600")}>
                        Recommended Bet
                      </div>
                      <div className={cn(
                        "text-lg font-bold",
                        darkMode ? "text-blue-400" : "text-blue-600"
                      )}>
                        {recommendation.recommended_bet_units} {recommendation.recommended_bet_units === 1 ? 'unit' : 'units'}
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <Separator className={darkMode ? "bg-slate-700" : "bg-slate-200"} />

            {/* Control Buttons */}
            <div className="grid grid-cols-2 gap-2">
              <Button 
                onClick={undo} 
                variant="outline" 
                size="sm"
                className={cn(
                  darkMode 
                    ? "bg-slate-700 border-slate-600 text-white hover:bg-slate-600" 
                    : "bg-white border-slate-300"
                )}
                disabled={history.length === 0}
              >
                <Undo className="w-4 h-4 mr-1" />
                Undo
              </Button>
              <Button 
                onClick={resetShoe} 
                variant="outline" 
                size="sm"
                className={cn(
                  darkMode 
                    ? "bg-slate-700 border-slate-600 text-white hover:bg-slate-600" 
                    : "bg-white border-slate-300"
                )}
              >
                <RotateCcw className="w-4 h-4 mr-1" />
                Reset
              </Button>
            </div>

          </CardContent>
        </Card>

        {/* EV Advantage Panel */}
        <Card className={cn(
          "shadow-lg border-2",
          darkMode
            ? "bg-gradient-to-r from-blue-950 to-indigo-950 border-blue-800"
            : "bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-300"
        )}>
          <CardHeader className="pb-3">
            <CardTitle className={cn(
              "text-base md:text-lg flex items-center gap-2",
              darkMode ? "text-blue-400" : "text-blue-600"
            )}>
              <TrendingUp className="w-5 h-5" />
              Advantage vs Casino (EV %)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
              {[
                { tc: -1, label: 'TC ≤ −1' },
                { tc: 0, label: 'TC = 0' },
                { tc: 1, label: 'TC ≥ +1' },
                { tc: 2, label: 'TC ≥ +2' }
              ].map(({ tc: tcVal, label }) => {
                const ev = calculateCountAdjustedEV(baseHouseEdge, tcVal, rules);
                return (
                  <div 
                    key={label}
                    className={cn(
                      "p-2 md:p-3 rounded-xl border-2 text-center",
                      getEVColor(ev)
                    )}
                  >
                    <div className="text-xs font-medium mb-1">{label}</div>
                    <div className="text-xl md:text-2xl font-bold">
                      {ev >= 0 ? '+' : ''}{ev.toFixed(2)}%
                    </div>
                  </div>
                );
              })}
            </div>
            <p className={cn(
              "text-xs mt-3 text-center",
              darkMode ? "text-slate-400" : "text-slate-600"
            )}>
              💡 Calculated based on selected rules. Each +1 in TC ≈ +0.5% edge.
            </p>
          </CardContent>
        </Card>

        {/* Card Overview */}
        <Card className={cn(
          "shadow-lg border-2",
          darkMode 
            ? "bg-slate-800 border-slate-700" 
            : "bg-white border-slate-200"
        )}>
          <CardHeader>
            <CardTitle className={cn(
              "text-base md:text-lg",
              darkMode ? "text-white" : "text-slate-900"
            )}>
              🃏 Card Overview
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-5 md:grid-cols-10 gap-1.5 md:gap-2">
              {['2','3','4','5','6','7','8','9','10','A'].map(card => (
                <div key={card} className="text-center">
                  <div className={cn(
                    "text-xl md:text-2xl font-bold mb-1 md:mb-2 p-2 md:p-3 rounded-lg border-2",
                    ['10','A'].includes(card) 
                      ? darkMode
                        ? 'bg-slate-900 text-white border-slate-700'
                        : 'bg-slate-800 text-white border-slate-700'
                      : darkMode
                        ? 'bg-slate-700 text-white border-slate-600'
                        : 'bg-white text-slate-900 border-slate-200'
                  )}>
                    {card}
                  </div>
                  <div className={cn(
                    "text-xs md:text-sm font-semibold mb-1 md:mb-2",
                    darkMode ? "text-slate-300" : "text-slate-700"
                  )}>
                    {cardsRemaining[card]}
                  </div>
                  <div className="flex gap-0.5 md:gap-1">
                    <Button 
                      onClick={() => applyCard(card)} 
                      size="sm"
                      variant="outline"
                      className={cn(
                        "flex-1 h-6 md:h-8 text-xs p-0",
                        darkMode 
                          ? "bg-slate-700 border-slate-600 text-white hover:bg-slate-600" 
                          : "bg-white border-slate-300"
                      )}
                      disabled={cardsRemaining[card] <= 0}
                    >
                      +
                    </Button>
                    <Button 
                      onClick={() => removeCard(card)} 
                      size="sm"
                      variant="outline"
                      className={cn(
                        "flex-1 h-6 md:h-8 text-xs p-0",
                        darkMode 
                          ? "bg-slate-700 border-slate-600 text-white hover:bg-slate-600" 
                          : "bg-white border-slate-300"
                      )}
                      disabled={cardsRemaining[card] >= (card === '10' ? rules.numDecks * 16 : rules.numDecks * 4)}
                    >
                      −
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            
            <div className="mt-4 flex gap-2">
              <Input 
                placeholder="Quick input: 10,J,A,7,3"
                value={quickInput}
                onChange={(e) => setQuickInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && processQuickInput()}
                className={cn(
                  darkMode 
                    ? "bg-slate-700 border-slate-600 text-white placeholder:text-slate-400" 
                    : "bg-white border-slate-300"
                )}
              />
              <Button 
                onClick={processQuickInput} 
                className={cn(
                  darkMode
                    ? "bg-slate-700 hover:bg-slate-600"
                    : "bg-slate-800 hover:bg-slate-700"
                )}
              >
                Add
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* FAQ / Info Panel */}
        <Card className={cn(
          "shadow-lg border-2",
          darkMode 
            ? "bg-slate-800 border-slate-700" 
            : "bg-white border-slate-200"
        )}>
          <CardHeader 
            className="pb-3 cursor-pointer" 
            onClick={() => setShowFAQ(!showFAQ)}
          >
            <div className="flex items-center justify-between">
              <CardTitle className={cn(
                "text-base md:text-lg flex items-center gap-2",
                darkMode ? "text-white" : "text-slate-900"
              )}>
                <HelpCircle className="w-5 h-5" />
                ℹ️ Info / FAQ
              </CardTitle>
              {showFAQ ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
            </div>
          </CardHeader>
          <AnimatePresence>
            {showFAQ && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
              >
                <CardContent className="space-y-3 pt-0">
                  <Separator className={darkMode ? "bg-slate-700" : ""} />
                  {FAQ_DATA.map((faq, idx) => (
                    <div key={idx} className={cn(
                      "p-3 rounded-lg border",
                      darkMode 
                        ? "bg-slate-900 border-slate-700" 
                        : "bg-slate-50 border-slate-200"
                    )}>
                      <div className={cn(
                        "font-semibold text-sm mb-1",
                        darkMode ? "text-blue-400" : "text-blue-600"
                      )}>
                        {faq.question}
                      </div>
                      <div className={cn(
                        "text-sm",
                        darkMode ? "text-slate-300" : "text-slate-600"
                      )}>
                        {faq.answer}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>

        {/* Advanced Rules Panel */}
        <AdvancedRulesPanel 
          rules={rules}
          setRules={setRules}
          darkMode={darkMode}
          showPanel={showRulesPanel}
          setShowPanel={setShowRulesPanel}
        />

        {/* Wonging Guide */}
        <Card className={cn(
          "shadow-lg border-2",
          darkMode
            ? "bg-gradient-to-r from-amber-950 to-orange-950 border-amber-800"
            : "bg-gradient-to-r from-amber-50 to-orange-50 border-amber-200"
        )}>
          <CardHeader>
            <CardTitle className={cn(
              "text-base md:text-lg flex items-center gap-2",
              darkMode ? "text-amber-400" : "text-amber-600"
            )}>
              <AlertCircle className="w-5 h-5" />
              Wonging Guide
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <X className={cn("w-4 h-4", darkMode ? "text-red-400" : "text-red-600")} />
              <span className={darkMode ? "text-slate-300" : "text-slate-700"}>
                <strong>Don't play</strong> at TC ≤ −1
              </span>
            </div>
            <div className="flex items-center gap-2">
              <TrendingUp className={cn("w-4 h-4", darkMode ? "text-green-400" : "text-green-600")} />
              <span className={darkMode ? "text-slate-300" : "text-slate-700"}>
                <strong>Increase bet</strong> at TC ≥ +2
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Check className={cn("w-4 h-4", darkMode ? "text-purple-400" : "text-purple-600")} />
              <span className={darkMode ? "text-slate-300" : "text-slate-700"}>
                <strong>Take insurance</strong> at TC ≥ +3
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Disclaimer */}
        <Card className={cn(
          "shadow-lg border",
          darkMode 
            ? "bg-slate-900 border-slate-800" 
            : "bg-slate-100 border-slate-200"
        )}>
          <CardContent className="p-4">
            <div className={cn(
              "text-xs text-center",
              darkMode ? "text-slate-500" : "text-slate-600"
            )}>
              <strong>⚠️ Disclaimer:</strong> This page is intended for education and simulation. 
              Gambling always involves risk, and there is no guarantee of profit even with optimal strategy 
              or card counting. Play responsibly and only with money you can afford to lose.
            </div>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
