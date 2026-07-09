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
