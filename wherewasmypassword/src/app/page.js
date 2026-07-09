// Import React and useState hook
import React, { useState } from 'react';

// Import components
import TutorialMap from '../components/TutorialMap';
import PassphraseQuiz from '../components/PassphraseQuiz';
import PassphraseCreator from '../components/PassphraseCreator';
// Sample path data
const samplePath = [
  { lat: 40.758896, lng: -73.985130, word: 'times', notes: 'Times Square', attributes: 'busy, bright' },
  { lat: 40.748817, lng: -73.985428, word: 'empire', notes: 'Empire State Building', attributes: 'tall, iconic' },
  { lat: 40.761433, lng: -73.977622, word: 'central', notes: 'Central Park', attributes: 'green, vast' },
];

// Home component
export default function Home() {
  // State hooks
  const [appState, setAppState] = useState('tutorial');
  const [masterPassphrase, setMasterPassphrase] = useState('');

  // Render TutorialMap component
  const renderTutorial = () => (
    <TutorialMap samplePath={samplePath} onComplete={() => setAppState('quiz')} />
  );

  // Render PassphraseQuiz component
  const renderQuiz = () => (
    <PassphraseQuiz samplePath={samplePath} onComplete={() => setAppState('create')} />
  );}
  