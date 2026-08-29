const express = require('express');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(express.static(path.join(__dirname, 'www')));

// Catch-all fallback for SPA routing (Express 5 safe)
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'www', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Attendance app server running on http://0.0.0.0:${PORT}`);
});
