# mca.js
A node.js module to read/write from/to region files of Minecraft.

##API Docs

###Loading the module

    var MCAManager = require("mca.js");

###Constructor

    var m = new MCAManager("/path/to/minecraft/world/region/r.0.0.mca");
    
###Methods

- **open( cb )** Opens a mca-file for reading/writing. Call this function before everything else.
  - cb: function(err){}
- **init( cb )** Loads the offset & sector table into memory to keep track of unused space in the file. Before calling write functions, it is neccessary to call this function first. For read operations, it is not neccessary, but it speeds it up, though.
  - cb: function(err){}
- **read( x, y, cb )** Read a chunk from the region
  - x: int The x-coordinate of the chunk. Must be between 0 and 31.
  - y: int The y-coordinate of the chunk. Must be between 0 and 31.
  - cb: function(err,chunk){}
- **write( x, y, chunk, cb )** Write a chunk to the region
  - x: int The x-coordinate of the chunk. Must be between 0 and 31.
  - y: int The y-coordinate of the chunk. Must be between 0 and 31.
  - chunk: Buffer A buffer that holds the chunkdata to write
  - cb: function(err){}
- **close( cb )** Closes the file. Call this function after all reading/writing to the file is done to free up memory.
  - cb: functtion(err){}

##License

GPL
