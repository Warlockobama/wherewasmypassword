# Create main.go file
@'
package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"

	firebase "firebase.google.com/go"
	"firebase.google.com/go/auth"
	"google.golang.org/api/option"
)

var (
	app    *firebase.App
	client *auth.Client
)

func init() {
	opt := option.WithCredentialsFile("path/to/your/firebase-credentials.json")
	var err error
	app, err = firebase.NewApp(context.Background(), nil, opt)
	if err != nil {
		log.Fatalf("error initializing app: %v\n", err)
	}

	client, err = app.Auth(context.Background())
	if err != nil {
		log.Fatalf("error getting Auth client: %v\n", err)
	}
}

func main() {
	http.HandleFunc("/", serveHTML)
	http.HandleFunc("/api/create-route", createRoute)
	http.HandleFunc("/api/practice", practice)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	log.Printf("Listening on port %s", port)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatal(err)
	}
}

func serveHTML(w http.ResponseWriter, r *http.Request) {
	http.ServeFile(w, r, "index.html")
}

func createRoute(w http.ResponseWriter, r *http.Request) {
	// Implement route creation logic here
	// This is where you'd interact with Firebase to store the route data
	w.Write([]byte("Route created"))
}

func practice(w http.ResponseWriter, r *http.Request) {
	// Implement practice mode logic here
	// This is where you'd retrieve route data from Firebase for practice
	w.Write([]byte("Practice mode"))
}
'@ | Out-File -Encoding utf8 main.go

# Create index.html file
@'
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Wherewasmypassword</title>
    <script src="https://unpkg.com/htmx.org@1.9.6"></script>
    <script src="https://maps.googleapis.com/maps/api/js?key=YOUR_API_KEY&callback=initMap" async defer></script>
    <script src="https://www.gstatic.com/firebasejs/9.0.0/firebase-app-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/9.0.0/firebase-auth-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore-compat.js"></script>
    <style>
        body, html {
            height: 100%;
            margin: 0;
            padding: 0;
            font-family: Arial, sans-serif;
        }
        #app {
            display: flex;
            flex-direction: column;
            height: 100%;
        }
        #map {
            flex-grow: 1;
            height: 400px;
        }
        #controls {
            padding: 10px;
            background-color: #f0f0f0;
        }
    </style>
</head>
<body>
    <div id="app">
        <h1>Wherewasmypassword</h1>
        <div id="map"></div>
        <div id="controls">
            <button hx-get="/api/create-route" hx-target="#app">Create Route</button>
            <button hx-get="/api/practice" hx-target="#app">Practice</button>
        </div>
    </div>

    <script>
        // Initialize Firebase
        const firebaseConfig = {
            // Your Firebase configuration here
        };
        firebase.initializeApp(firebaseConfig);

        let map;
        let panorama;
        let markers = [];
        let currentRoute = [];

        function initMap() {
            const defaultLocation = { lat: 40.7128, lng: -74.0060 };
            
            map = new google.maps.Map(document.getElementById("map"), {
                center: defaultLocation,
                zoom: 14,
            });

            panorama = new google.maps.StreetViewPanorama(
                document.getElementById("map"),
                {
                    position: defaultLocation,
                    pov: { heading: 165, pitch: 0 },
                    zoom: 1,
                }
            );

            map.setStreetView(panorama);
        }

        function addMarker(position) {
            const marker = new google.maps.Marker({
                position: position,
                map: panorama,
            });
            markers.push(marker);
            currentRoute.push(position);
        }

        function clearMarkers() {
            markers.forEach(marker => marker.setMap(null));
            markers = [];
            currentRoute = [];
        }

        function encryptAndStore(passphrase) {
            // Implement encryption and Firebase storage here
            console.log("Encrypting and storing:", passphrase);
            // Example Firebase storage:
            firebase.firestore().collection('routes').add({
                user: firebase.auth().currentUser.uid,
                route: currentRoute,
                passphrase: passphrase // In real app, encrypt this!
            })
            .then((docRef) => {
                console.log("Route saved with ID: ", docRef.id);
            })
            .catch((error) => {
                console.error("Error adding route: ", error);
            });
        }

        // HTMX handlers
        htmx.on("htmx:afterSwap", function(event) {
            if (event.detail.target.id === "app") {
                initMap();
            }
        });

        // Firebase Auth state observer
        firebase.auth().onAuthStateChanged((user) => {
            if (user) {
                console.log("User is signed in");
            } else {
                console.log("No user is signed in");
                // Implement sign-in logic here
            }
        });
    </script>
</body>
</html>
'@ | Out-File -Encoding utf8 index.html

# Create go.mod file
@'
module wherewasmypassword

go 1.16

require (
	firebase.google.com/go v3.13.0+incompatible
	google.golang.org/api v0.114.0
)
'@ | Out-File -Encoding utf8 go.mod

# Output instructions
Write-Host @"
Files created: main.go, index.html, go.mod

To run the application:

1. Replace 'YOUR_API_KEY' in index.html with your Google Maps API key.
2. Update the Firebase configuration in index.html with your project's details.
3. Update the path to your Firebase credentials JSON file in main.go.
4. Run 'go mod tidy' to download dependencies.
5. Run 'go run main.go' to start the server.

Remember to implement proper security measures, especially for handling passphrases and user data.
"@