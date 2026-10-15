const { handleVoices } = require("../server/elevenlabs");

module.exports = (req, res) => handleVoices(req, res);
