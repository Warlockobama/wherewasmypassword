package main

import (
	"fmt"
	"log"
	"net/http"

	// Import Google Maps API for embedding
	_ "embed"
)

// Embed the HTML file as a template
var htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Street View Controller</title>

    <!-- CSS Styles -->
    <style>
        /* Full-screen container */
        .container {
            width: 100%;
            height: 100vh;
            position: relative;
        }

        #map-container {
            /* Take up most of the screen */
            width: 80%;
            height: 60%;
            position: absolute;
            top: 20px;
            left: 10%;
            border: 2px solid black;
        }

        .game-controller {
            /* Position controller at bottom center */
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: white;
            padding: 10px;
            border-radius: 10px;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
        }

        /* Controller elements */
        .controller {
            display: flex;
            gap: 10px;
            margin: 10px 0;
        }
    </style>
</head>
<body>
    <div id="map-container"></div>
    <script src="https://maps.googleapis.com/maps/api/js?key=YOUR_API_KEY&v=3.exp&callback=initMap"></script>
    <script>
        let map;

        function initMap() {
            const options = {
                streetView: true,
                zoomControlOptions: {
                    position: 'TOP_CENTER'
                },
                mapTypeControlOptions: {
                    position: 'TOP_LEFT'
                }
            };

            map = new google.maps.Map(document.getElementById('map-container'), options);
        }

        // Handle controller input
        document.addEventListener('keydown', (e) => {
            switch(e.key) {
                case 'ArrowUp':
                    if (map.getTilt() < 90) map.setTilt(map.getTilt() + 10);
                    break;
                case 'ArrowDown':
                    if (map.getTilt() > -90) map.setTilt(map.getTilt() - 10);
                    break;
                case 'ArrowLeft':
                    map.setHeading((map.getHeading() - 20) % 360);
                    break;
                case 'ArrowRight':
                    map.setHeading((map.getHeading() + 20) % 360);
                    break;
            }
        });
    </script>
</body>
</html>`

// Function to serve the HTML content
func ServeHTTP(w http.ResponseWriter, r *http.Request) {
        fmt.Fprintf(w, htmlContent)
}

func main() {
        // Set up server
        s := &http.Server{
         Addr: ":8080",
                Handler: http.HandlerFunc(ServeHTTP),
        }

        log.Println("Starting server on :8080")
        err := s.ListenAndServe()
        if err != nil {
                log.Fatal(err)
        }
}