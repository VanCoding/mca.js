var fs = require("fs");
var zlib = require("zlib");

module.exports = MCAManager;


function MCAManager(path){
    this.path = path;
}

MCAManager.prototype.create = function(cb){
    fs.writeFile(this.path,new Buffer(8192),function(err){
        if(err){
            cb(err);
            return;
        }
        cb(null);
    });
}

MCAManager.prototype.open = function(cb){
    var self = this;
    fs.open(this.path,"r+",function(err,handle){        
        if(err){
            cb(err);
            return;
        }
        self.handle = handle;
        cb(null);
    });
}

MCAManager.prototype.init = function(cb){
    var self = this;
    var buf = new Buffer(8192);
    fs.read(this.handle,buf,0,buf.length,0,function(err){
        if(err){
            cb(err);
            return;
        }
        self.head = {};
        self.availablespace = [{start:8192,end:-1}];
        var i = 0;
        for(var x = 0; x < 32; x++){     
            self.head[x] = {};
            for(var y = 0; y < 32; y++){
                (function(x,y){
                    var offset = (buf[i*4]*256*256+buf[i*4+1]*256+buf[i*4+2])*4096;
                    var sectors = buf[i*4+3];
                    var timestamp = buf.readUInt32BE(4096+i*4);                    
                    self.head[x][y] = {
                        offset:offset,
                        sectors:sectors,
                        timestamp:timestamp
                    };
                    if(offset){                        
                        self.useSpace(offset,sectors*4096);
                    }
                    i++;
                })(x,y);
            }            
        }
        cb(null);
    });
}

MCAManager.prototype.has = function(x,y,cb){
    this.getPosition(x,y,function(err,offset){
        if(err){
            cb(err);
            return;
        }
        cb(null,offset != undefined);
    });
}

MCAManager.prototype.useSpace = function(offset,length){
    for(var i = 0; i < this.availablespace.length; i++){
        var entry = this.availablespace[i];
        if((offset <= entry.end || entry.end == -1) && offset >= entry.start){                                    
            if(offset == entry.start && offset+length-1 == entry.end){
                this.availablespace.splice(i,1);
            }else if(offset == entry.start){
                entry.start += length;
            }else if(offset+length-1 == entry.end){
                entry.end -= length;
            }else{
                this.availablespace.splice(i+1,0,{start:offset+length,end:entry.end});
                entry.end = offset-1;                
            }
            break;
        }
    }
}
MCAManager.prototype.findSpace = function(length){
    for(var i = 0; i < this.availablespace.length; i++){
        var entry = this.availablespace[i];
        if(entry.end-entry.start+1 >= length){
            return entry.start;
        }
    }    
}
MCAManager.prototype.freeSpace = function(start,length){
    var end = start+length-1;    
    for(var i = 0; i < this.availablespace.length; i++){
        var entryA = this.availablespace[i];
        var entryB = this.availablespace[i+1];
        if(start >= entryA.start && (start <= entryA.end || entryA.end == -1)){
            entryA.end = start+length-1;
            if(entryA.end == entryB.start-1){
                entryA.end = entryB.end;
                this.availablespace.splice(i+1,1);
            }
            break;
        }else if(start > entryA.end && start < entryB.start){
            if(start == entryA.end+1){
                entryA.end = end;
            }else{
                entryA = {start:start,end:end};
                this.availablespace.splice(i+1,0,entryA);
                i++;
            }            
            if(entryA.end == entryB.start-1){
                entryA.end = entryB.end;
                this.availablespace.splice(i+1,1);
            }           
            break;
        }
    }
}


MCAManager.prototype.getPosition = function(x,y,cb){
    if(this.head){
        var pos = this.head[x][y];
        if(pos.offset){
            cb(null,pos.offset,pos.sectors);
        }else{
            cb(null);
        }
    }else{
        var buf = new Buffer(4);
        fs.read(this.handle,buf,0,buf.length,(y*32+x)*4,function(err){
            if(err){
                cb(err);
                return;
            }        
            var offset = (buf[0] *256*256 + buf[1] * 256 + buf[2])*4096;
            var sectors = buf[3]; 
            if(offset){
                cb(null,offset,sectors);
            }else{
                cb(null);
            }      
        });
    }
}

MCAManager.prototype.getLengthAndCompression = function(offset,cb){
    buf = new Buffer(5);
    fs.read(this.handle,buf,0,buf.length,offset,function(err){
        if(err){
            cb(err);
            return;
        }
        var length = buf.readInt32BE(0);
        var compression = buf[4];
        cb(null,length,compression);
    });
}

MCAManager.prototype.getPositionLengthAndCompression = function(x,y,cb){
    var self = this;
    self.getPosition(x,y,function(err,offset){
        if(err){
            cb(err);
            return;
        }
        if(offset){
            self.getLengthAndCompression(offset,function(err,length,compression){
                if(err){
                    cb(err);
                    return;
                }
                cb(null,offset,length,compression);
            });
        }else{
            cb(null);
        } 
    });
}

MCAManager.prototype.readRaw = function(x,y,cb){
    var self = this;
    self.getPositionLengthAndCompression(x,y,function(err,offset,length,compression){
        if(err){
            cb(err);
            return;
        }
        if(offset){
            buf = new Buffer(length);
            fs.read(self.handle,buf,0,buf.length,offset+5,function(err){
                if(err){
                    cb(err);
                    return;
                }
                cb(null,buf,compression);
            });           
        }else{
            cb(null);
        }       
    });
}

MCAManager.prototype.read = function(x,y,cb){
    this.readRaw(x,y,function(err,data,compression){
        if(err){
            cb(err);
            return;
        }        
        switch(compression){
            case 1:
                zlib.gunzip(data,cb);
                break;
            case 2:
                zlib.inflate(data,cb);
                break;
            default:
                cb(new Error("Compression not supported"));
                break;      
        }
    });
}

MCAManager.prototype.setPosition = function(x,y,offset,sectors,cb){
    var self = this;
    var pos = new Buffer(4);
    offset/=4096;
    pos[0] = offset>>16;
    pos[1] = (offset>>8)%256;
    pos[2] = offset%256
    pos[3] = sectors;
    fs.write(self.handle,pos,0,pos.length,(y*32+x)*4,function(err){
        if(err){
            cb(err);
            return;
        }
        self.head[x][y].offset = offset;
        self.head[x][y].sectors = sectors;
        cb(null);
    });
}

MCAManager.prototype.writeRawAt = function(offset,data,compression,cb){
    var self = this;
    var head = new Buffer(5);
    head.writeUInt32BE(data.length,0);
    head[4] = compression;
    fs.write(self.handle,head,0,head.length,offset,function(err){
        if(err){
            cb(err);
            return;
        }
        fs.write(self.handle,data,0,data.length,offset+head.length,function(err){
            if(err){
                cb(err);
                return;
            }
            cb(null);
        });
    });    
}

MCAManager.prototype.writeRaw = function(x,y,data,compression,cb){
    var self = this;
    self.getPosition(x,y,function(err,offset,sectors){        
        if(err){
            cb(err);
            return;
        }        
        if(offset && data.length <= sectors*4096){
            self.writeRawAt(offset,data,compression,cb);
        }else{            
            var newsectors = Math.ceil(data.length/4096);
            var newoffset = self.findSpace(newsectors*4096);            
            self.useSpace(newoffset,newsectors*4096);            
            self.writeRawAt(newoffset,data,compression,function(err){
                if(err){
                    cb(err);
                    return;
                }                
                self.setPosition(x,y,newoffset,newsectors,function(err){
                    if(err){
                        cb(err);
                        return;
                    }
                    if(offset){
                        self.freeSpace(offset,sectors*4096);
                    }
                    cb(null);
                });                
            });
        }
    });
}

MCAManager.prototype.write = function(x,y,data,cb){
    var self = this;
    zlib.deflate(data,function(err,data){
        if(err){
            cb(err);
            return;
        }
        self.writeRaw(x,y,data,2,cb);
    });
}

MCAManager.prototype.close = function(cb){
    fs.close(this.handle,cb);
    delete this.handle;
    delete this.head;
    delete this.availablespace;
}