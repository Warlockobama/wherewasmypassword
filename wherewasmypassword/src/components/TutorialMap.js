import React, { useState, useEffect, useRef } from 'react';
import { GoogleMap, StreetViewPanorama, Marker, useJsApiLoader } from '@react-google-maps/api';

const TutorialMap = ({ onComplete, samplePath }) => {
  const { isLoaded } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY,
    libraries: ['geometry'],
  });

  const [selectedMarker, setSelectedMarker] = useState(null);
  const [panoramaError, setPanoramaError] = useState(false);
  const mapRef = useRef(null);
  const panoramaRef = useRef(null);

  useEffect(() => {
    if (mapRef.current && panoramaRef.current) {
      const map = mapRef.current;
      const panorama = panoramaRef.current;
      map.setStreetView(panorama);
    }
  }, [mapRef, panoramaRef]);

  const handleMarkerClick = (marker) => {
    console.log('Marker clicked:', marker);
    setSelectedMarker(marker);
    if (panoramaRef.current) {
      panoramaRef.current.setPosition(marker);
    }
  };

  if (!isLoaded) return <div>Loading map...</div>;

  return (
    <div style={{ height: '600px', width: '100%', position: 'relative' }}>
      <GoogleMap
        mapContainerStyle={{ height: '100%', width: '100%' }}
        center={samplePath[0]}
        zoom={18}
        onLoad={(map) => { mapRef.current = map; }}
      >
        <StreetViewPanorama
          position={samplePath[0]}
          visible={true}
          options={{
            addressControl: true,
            fullscreenControl: true,
            panControl: true,
            zoomControl: true,
            scrollwheel: true,
            clickToGo: true,
            disableDefaultUI: false,
            imageDateControl: true,
          }}
          onLoad={(panorama) => { 
            panoramaRef.current = panorama;
            console.log('StreetViewPanorama loaded');
            panorama.addListener('status_changed', () => {
              if (panorama.getStatus() !== google.maps.StreetViewStatus.OK) {
                console.error('Panorama failed to load:', panorama.getStatus());
                setPanoramaError(true);
              }
            });
          }}
        />
        {samplePath.map((marker, index) => (
          <Marker
            key={index}
            position={marker}
            label={`${index + 1}`}
            onClick={() => handleMarkerClick(marker)}
          />
        ))}
      </GoogleMap>
      {selectedMarker && (
        <div style={{
          position: 'absolute',
          bottom: '10px',
          left: '10px',
          backgroundColor: 'white',
          padding: '10px',
          borderRadius: '5px',
          boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
          zIndex: 1000,
        }}>
          <h3>Marker {samplePath.indexOf(selectedMarker) + 1}</h3>
          <p>Word: {selectedMarker.word}</p>
          <p>Notes: {selectedMarker.notes}</p>
          <p>Attributes: {selectedMarker.attributes}</p>
        </div>
      )}
      <button
        style={{
          position: 'absolute',
          bottom: '10px',
          right: '10px',
          zIndex: 1000,
          padding: '10px',
          backgroundColor: 'blue',
          color: 'white',
          border: 'none',
          borderRadius: '5px',
          cursor: 'pointer',
        }}
        onClick={onComplete}
      >
        Next
      </button>
    </div>
  );
};

export default TutorialMap;
