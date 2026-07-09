# Create components directory if it doesn't exist
if (-not (Test-Path "src\components")) {
    New-Item -ItemType Directory -Force -Path "src\components"
}

# Update SVGMarker component
$svgMarkerContent = @"
import React from 'react';
import { OverlayView } from '@react-google-maps/api';

const SVGMarker = ({ position, svgPath, label, onClick }) => {
  return (
    <OverlayView
      position={position}
      mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
    >
      <div
        className="w-[30px] h-[30px] cursor-pointer absolute -top-[15px] -left-[15px]"
        style={{
          background: `url(${svgPath}) no-repeat center center`,
          backgroundSize: 'contain',
        }}
        onClick={onClick}
      >
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-white font-bold">
          {label}
        </div>
      </div>
    </OverlayView>
  );
};

export default SVGMarker;
"@
Set-Content -Path "src\components\SVGMarker.js" -Value $svgMarkerContent

# Update TutorialMap component
$tutorialMapContent = @"
import React, { useState, useEffect, useRef } from 'react';
import { GoogleMap, StreetViewPanorama, useJsApiLoader } from '@react-google-maps/api';

const TutorialMap = ({ onComplete, samplePath }) => {
  const { isLoaded } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY,
  });

  const [selectedMarker, setSelectedMarker] = useState(null);
  const panoramaRef = useRef(null);

  useEffect(() => {
    if (panoramaRef.current) {
      console.log('StreetViewPanorama loaded');
      samplePath.forEach((marker, index) => {
        const markerElement = document.createElement('div');
        markerElement.innerHTML = `<img src='/svg/marker${index + 1}.svg' width='30' height='30' />`;
        markerElement.style.cursor = 'pointer';
        markerElement.addEventListener('click', () => setSelectedMarker(marker));

        const streetViewPanoramaObject = panoramaRef.current.getObject();
        streetViewPanoramaObject.addListener('position_changed', () => {
          const position = streetViewPanoramaObject.getPosition();
          const markerPov = streetViewPanoramaObject.getPov();
          markerPov.heading = google.maps.geometry.spherical.computeHeading(position, marker);
          streetViewPanoramaObject.addOverlayMapType(new google.maps.marker.AdvancedMarkerView({
            position: marker,
            content: markerElement,
            pov: markerPov,
          }));
        });
      });
    }
  }, [samplePath]);

  console.log('Rendering TutorialMap, isLoaded:', isLoaded);

  return isLoaded ? (
    <div className="relative w-full h-[400px]">
      <GoogleMap
        mapContainerClassName="w-full h-full"
        center={samplePath[0]}
        zoom={18}
      >
        <StreetViewPanorama
          position={samplePath[0]}
          visible={true}
          options={{
            enableCloseButton: false,
            addressControl: true,
            fullscreenControl: true,
            motionTracking: true,
            motionTrackingControl: true,
            showRoadLabels: false,
          }}
          onLoad={(panorama) => {
            panoramaRef.current = panorama;
            console.log('StreetViewPanorama onLoad called');
          }}
        />
      </GoogleMap>
      {selectedMarker && (
        <div className="absolute bottom-2 left-2 bg-white p-2 rounded shadow-md z-10">
          <h3 className="font-bold">Marker {samplePath.indexOf(selectedMarker) + 1}</h3>
          <p>Notes: {selectedMarker.notes}</p>
          <p>Attributes: {selectedMarker.attributes}</p>
        </div>
      )}
      <button
        className="absolute bottom-2 right-2 z-10 bg-blue-500 text-white px-4 py-2 rounded"
        onClick={onComplete}
      >
        Next
      </button>
    </div>
  ) : <div>Loading map...</div>;
};

export default TutorialMap;
"@
Set-Content -Path "src\components\TutorialMap.js" -Value $tutorialMapContent

# Update PassphraseCreator component
$passphraseCreatorContent = @"
import React, { useState, useEffect, useRef } from 'react';
import { GoogleMap, StreetViewPanorama, useJsApiLoader } from '@react-google-maps/api';

const PassphraseCreator = ({ onComplete }) => {
  const [markers, setMarkers] = useState([]);
  const { isLoaded } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY,
  });

  const panoramaRef = useRef(null);

  useEffect(() => {
    if (panoramaRef.current) {
      console.log('StreetViewPanorama loaded in PassphraseCreator');
      markers.forEach((marker, index) => {
        const markerElement = document.createElement('div');
        markerElement.innerHTML = `<img src='/svg/marker${index + 1}.svg' width='30' height='30' />`;
        markerElement.style.cursor = 'pointer';

        const streetViewPanoramaObject = panoramaRef.current.getObject();
        streetViewPanoramaObject.addListener('position_changed', () => {
          const position = streetViewPanoramaObject.getPosition();
          const markerPov = streetViewPanoramaObject.getPov();
          markerPov.heading = google.maps.geometry.spherical.computeHeading(position, marker);
          streetViewPanoramaObject.addOverlayMapType(new google.maps.marker.AdvancedMarkerView({
            position: marker,
            content: markerElement,
            pov: markerPov,
          }));
        });
      });
    }
  }, [markers]);

  const handleMapClick = (event) => {
    const newMarker = {
      lat: event.latLng.lat(),
      lng: event.latLng.lng(),
      word: prompt('Enter a word, number, or symbol for this location:')
    };
    if (newMarker.word) {
      setMarkers([...markers, newMarker]);
    }
  };

  const handleComplete = () => {
    if (markers.length < 3) {
      alert('Please add at least 3 markers to create your passphrase.');
      return;
    }
    const passphrase = markers.map(marker => marker.word).join(' ');
    onComplete(passphrase);
  };

  console.log('Rendering PassphraseCreator, isLoaded:', isLoaded);

  return isLoaded ? (
    <div className="relative w-full h-[400px]">
      <GoogleMap
        mapContainerClassName="w-full h-full"
        center={{ lat: 40.7128, lng: -74.0060 }}
        zoom={18}
        onClick={handleMapClick}
      >
        <StreetViewPanorama
          position={{ lat: 40.7128, lng: -74.0060 }}
          visible={true}
          options={{
            enableCloseButton: false,
            addressControl: true,
            fullscreenControl: true,
            motionTracking: true,
            motionTrackingControl: true,
            showRoadLabels: false,
          }}
          onLoad={(panorama) => {
            panoramaRef.current = panorama;
            console.log('StreetViewPanorama onLoad called in PassphraseCreator');
          }}
        />
      </GoogleMap>
      <button
        className="absolute bottom-2 right-2 z-10 bg-blue-500 text-white px-4 py-2 rounded"
        onClick={handleComplete}
      >
        Create Passphrase
      </button>
    </div>
  ) : <div>Loading map...</div>;
};

export default PassphraseCreator;
"@
Set-Content -Path "src\components\PassphraseCreator.js" -Value $passphraseCreatorContent

# Update PassphraseQuiz component
$passphraseQuizContent = @"
import React, { useState } from 'react';

const PassphraseQuiz = ({ samplePath, onComplete }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [userInput, setUserInput] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (userInput.toLowerCase() === samplePath[currentIndex].word.toLowerCase()) {
      if (currentIndex === samplePath.length - 1) {
        onComplete();
      } else {
        setCurrentIndex(currentIndex + 1);
        setUserInput('');
        setError('');
      }
    } else {
      setError('Incorrect. Try again!');
    }
  };

  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-4">Quiz: Enter the word for location {currentIndex + 1}</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type='text'
          value={userInput}
          onChange={(e) => setUserInput(e.target.value)}
          placeholder='Enter word'
          className="w-full p-2 border rounded"
        />
        <button type='submit' className="bg-blue-500 text-white px-4 py-2 rounded">Submit</button>
      </form>
      {error && <p className="text-red-500 mt-2">{error}</p>}
    </div>
  );
};

export default PassphraseQuiz;
"@
Set-Content -Path "src\components\PassphraseQuiz.js" -Value $passphraseQuizContent


# Create src/app directory if it doesn't exist
if (-not (Test-Path "src\app")) {
    New-Item -ItemType Directory -Force -Path "src\app"
}

# Update main page component (src/app/page.js)
$mainPageContent = @"
'use client';

import React, { useState } from 'react';
import TutorialMap from '../components/TutorialMap';
import PassphraseQuiz from '../components/PassphraseQuiz';
import PassphraseCreator from '../components/PassphraseCreator';

const samplePath = [
  { lat: 40.7128, lng: -74.0060, word: 'secure', notes: 'This building looks very secure', attributes: 'tall, sturdy' },
  { lat: 40.7129, lng: -74.0061, word: 'password', notes: 'The street sign reminds me of a password', attributes: 'green, rectangular' },
  { lat: 40.7130, lng: -74.0062, word: 'example', notes: 'This is a good example of architecture', attributes: 'historic, ornate' },
];

export default function Home() {
  const [appState, setAppState] = useState('tutorial');
  const [masterPassphrase, setMasterPassphrase] = useState('');

  const renderComponent = () => {
    switch (appState) {
      case 'tutorial':
        return <TutorialMap samplePath={samplePath} onComplete={() => setAppState('quiz')} />;
      case 'quiz':
        return <PassphraseQuiz samplePath={samplePath} onComplete={() => setAppState('create')} />;
      case 'create':
        return <PassphraseCreator onComplete={(passphrase) => { setMasterPassphrase(passphrase); console.log('Master passphrase created:', passphrase); }} />;
      default:
        return <div>Loading...</div>;
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-24">
      <div className="z-10 max-w-5xl w-full items-center justify-between font-mono text-sm">
        <h1 className="text-4xl font-bold mb-8">WhereWasMyPassword</h1>
        {renderComponent()}
      </div>
    </main>
  );
}
"@
Set-Content -Path "src\app\page.js" -Value $mainPageContent

Write-Host "Components created successfully. You can now run 'npm run dev' to test the changes."

