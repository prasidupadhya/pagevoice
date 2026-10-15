const { handleVoices } = require("../web/server/narration.cjs");

module.exports = (req, res) => handleVoices(req, res);
