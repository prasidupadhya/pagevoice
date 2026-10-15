const { handleTts } = require("../web/server/narration.cjs");

module.exports = (req, res) => handleTts(req, res);
