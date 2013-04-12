var fs = require("fs");
var zlib = require("zlib");
var WeakMap = require("weakmap.js");

module.exports = MCAManager;


function MCAManager(path){
	var self = this;
    this.path = path;
    this.opqueue = [];
	this.operating = false;
	this.cache = new WeakMap();
	this.cachecallbacks = {};
	this.cache.ondelete = function(){
		self.cleanup();
	}
}

MCAManager.prototype.cleanup = function(){
	if(!this.cache.keys().length){
		this._close = function(){
			delete this.handle;
			delete this.head;
			delete this.availablespace;
			this.opqueue = [];
			this.operating = false;
		}
	}
}

MCAManager.prototype._operate = function(){
	var self = this;
	if(this.opqueue.length){
		var op = this.opqueue[0];
        this.opqueue.splice(0,1);
		switch(op[0]){
			case 0:
				var buf = new Buffer(op[1]);
				fs.read(self.handle,buf,0,buf.length,op[2],function(err){
					if(err){
						op[3](err);
					}else{
						op[3](null,buf);
					}
					self._operate();
				});
				break;
			case 1:
				var buf = op[1];
				fs.write(self.handle,buf,0,buf.length,op[2],function(err){
					if(err){
						op[3](err);
					}else{
						op[3](null);
					}
					self._operate();
				});
				break;
			case 2:
				fs.close(self.handle,op[1]);
				break;
		}
	}else{
		this.operating = false;
	}
}

MCAManager.prototype._op = function(args){
	this.opqueue.push(args);
	if(!this.operating){
        this.operating = true;
		this._operate();
	}
}

MCAManager.prototype._close = function(cb){
	this._op([2,cb]);
}

MCAManager.prototype._write = function(buf,offset,cb){
	this._op([1,buf,offset,cb]);
}

MCAManager.prototype._read = function(length,offset,cb){
	this._op([0,length,offset,cb]);
}

MCAManager.prototype.open = function(cb){
	if(this.handle){
		cb();
	}else{
		var cbs = this.opencallbacks;
		if(!cbs){
			cbs = this.opencallbacks = [cb];
			function callcallbacks(err){
				delete self.opencallbacks;
				for(var i = 0; i < cbs.length; i++){
					cbs[i](err);
				}
			}		
			var self = this;
			fs.open(self.path,"r+",function(err,handle){        
				if(err){
					callcallbacks(err);
					return;
				}
				self.handle = handle;		
				callcallbacks(null);
			});
		}else{
			cbs.push(cb);
		}
	}
}


MCAManager.prototype.init = function(cb){
    var self = this;
	if(this.head){
		cb();
	}else{
		this.open(function(err){	
			if(err){
				cb(err);
				return;
			}
		
			var cbs = this.initcallbacks;
			if(!cbs){
				cbs = this.initcallbacks = [cb];
				function callcallbacks(err){
					delete self.initcallbacks;
					for(var i = 0; i < cbs.length; i++){
						cbs[i](err);
					}
				}
				self._read(8192,0,function(err,buf){
					if(err){
						callcallbacks(err);
						return;
					}
					self.head = {};
					self.availablespace = [{start:8192,end:-1}];
					var i = 0;
					for(var y = 0; y < 32; y++){
						for(var x = 0; x < 32; x++){ 
							(function(x,y){
								var offset = (buf[i*4]*256*256+buf[i*4+1]*256+buf[i*4+2])*4096;
								var sectors = buf[i*4+3];
								var timestamp = buf.readUInt32BE(4096+i*4);      
								if(!self.head[x]){
									self.head[x] = {};
								}
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
					callcallbacks(null);
				});
			}else{
				cbs.push(cb);
			}
		});
	}
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
	var self = this;
	this.open(function(err){
		if(err){
			cb(err);
			return;
		}

		if(self.head){
			var pos = self.head[x];
			if(pos){
				pos = pos[y];
			}
			if(pos && pos.offset){
				cb(null,pos.offset,pos.sectors);
			}else{
				cb(null);
			}
		}else{
			self._read(4,(y*32+x)*4,function(err,buf){
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
	});
}

MCAManager.prototype.getLengthAndCompression = function(offset,cb){
    this._read(5,offset,function(err,buf){
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
			self._read(length,offset+5,function(err,buf){
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
	var self = this;
	var data = this.cache.get(x+"/"+y);
	if(!data){
		var cbs = this.cachecallbacks[x+"/"+y];
		if(!cbs){
			this.cachecallbacks[x+"/"+y] = cbs = [cb];			
			function callcallbacks(err,data){
				delete self.cachecallbacks[x+"/"+y];
				if(data){
					self.cache[x+"/"+y] = data;
				}
				for(var i = 0; i < cbs.length; i++){
					cbs[i](err,data);
				}
			}
			
			this.readRaw(x,y,function(err,data,compression){
				if(err){
					callcallbacks(err);
					return;
				}
				if(data){
					switch(compression){
						case 1:
							zlib.gunzip(data,callcallbacks);
							break;
						case 2:
							zlib.inflate(data,callcallbacks);
							break;
						default:
							callcallbacks(new Error("Compression not supported"));
							break;      
					}
				}else{
					callcallbacks(null);
				}
			});
		}else{
			cbs.push(cb);
		}
	}else{
		cb(null,data);
	}
}

MCAManager.prototype.setPosition = function(x,y,offset,sectors,cb){
    var self = this;
    var pos = new Buffer(4);
    offset/=4096;
    pos[0] = offset>>16;
    pos[1] = (offset>>8)%256;
    pos[2] = offset%256
    pos[3] = sectors;
    self._write(pos,(y*32+x)*4,function(err){
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
    self._write(head,offset,function(err){
        if(err){
            cb(err);
            return;
        }
        self._write(data,offset+head.length,function(err){
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
	self.init(function(err){
		if(err){
			cb(err);
			return;
		}
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