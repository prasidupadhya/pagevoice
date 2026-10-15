const { handleTts } = require("../server/elevenlabs");

module.exports = (req, res) => handleTts(req, res);
