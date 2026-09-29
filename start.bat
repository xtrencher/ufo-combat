@echo off
REM Serves the game folder locally and prints the URL to open.
set PORT=5173
echo Starting UFO COMBAT local server...
echo Open http://localhost:%PORT% in your browser once the server starts.
npx --yes serve . -l %PORT%
