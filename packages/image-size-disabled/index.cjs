"use strict";

function disabledImageSize() {
  throw new Error(
    "Penglai Office disables pptxgenjs image probing; 0.5.6 accepts text-only PPTX creation",
  );
}

module.exports = disabledImageSize;
module.exports.imageSize = disabledImageSize;
