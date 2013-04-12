# mca.js
A node.js module to read/write from/to region files of Minecraft.

##API Docs

###Loading the module

    var MCAManager = require("mca.js");

###Constructor

    var m = new MCAManager("/path/to/minecraft/world/region/r.0.0.mca");
    
###Methods


- **read( x, y, cb )** Read a chunk from the region
  - x: int The x-coordinate of the chunk. Must be between 0 and 31.
  - y: int The y-coordinate of the chunk. Must be between 0 and 31.
  - cb: function(err,chunk){}
- **write( x, y, chunk, cb )** Write a chunk to the region
  - x: int The x-coordinate of the chunk. Must be between 0 and 31.
  - y: int The y-coordinate of the chunk. Must be between 0 and 31.
  - chunk: Buffer A buffer that holds the chunkdata to write
  - cb: function(err){}

##License

GPL
