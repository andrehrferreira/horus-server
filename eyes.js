/* 
 * Horus Eyes
 * @author André Ferreira <andrehrf@gmail.com>
 */

var fs = require("fs"),
    os = require("os"),
    url = require("url"),
    crc32 = require("crc-32"),
    md5 = require("md5"),
    MongoServer = require("mongodb").MongoClient,
    _ = require("lodash"),
    async = require("async"),
    url = require("url"),
    http = require("http"),
    https = require("https"),
    exec = require('child_process').exec;
    
var HorusEyes = {
    /**
     * Database 
     * @type object
     */
    db: null,
            
    /**
     * Links list
     * @type object
     */
    links: {},
    
    /**
     * setTimeouts list
     * @type object
     */
    times: {},
    
    /**
     * Start the big brother
     * @return void
     */
    init: function(){
        //console.log("Loading links...");
        
        HorusEyes.db.collection("links").find({}, {"_id": 1, "link": 1}).toArray(function(err, docs){
            if(docs.length > 0){
                docs.forEach(function(elem, index){
                    //console.log("Watch: "+elem["link"]);
                    HorusEyes.set(elem["_id"], elem["link"]);
                });
            }
        });
    },
    
    /**
     * Set new link to watch
     * @param integer id
     * @param string link
     * @return void
     */
    set: function(id, link){
        HorusEyes.links[id] = link;
        HorusEyes.watch(HorusEyes.links[id]);
        HorusEyes.times[id] = setInterval(function(l){ HorusEyes.watch(l); }, (id/100)+60000, link);
    },
    
    /**
     * Delete link to watch
     * @param integer id
     * @return void
     */
    delete: function(id){
        if(id in HorusEyes.times)
            clearTimeout(HorusEyes.times[id]);
    },
    
    /**
     * Watch link 
     * @param string link
     * @return void
     */
    watch: function(link){
        if(typeof link === "string"){
            var urlArr = url.parse(link);
            var protocol = (urlArr.protocol === "http:") ? http : https;
            var port = (urlArr.protocol === "http:") ? 80 : 443;
            var id = Math.abs(crc32.str(md5(link)));
            var now = new Date();

            HorusEyes.db.collection("links").find({"_id": id}, {"link": 1, "lastmodified": 1, "etag": 1}).limit(1).toArray(function(err, docs){
                if(docs.length <= 0)
                    HorusEyes.db.collection("links").insert({"_id": id, "link": link});
                
                var options = {
                    host: urlArr.host,
                    path: urlArr.path,
                    port: port,
                    method: 'HEAD',
                    headers: {
                        "Accept": "*/*",
                        "User-Agent": "Horus",
                        "Content-Type": "text/plain; charset=utf-8",
                        "Accept-Language": "pt-BR,pt;q=0.8,en-US;q=0.6,en;q=0.4"
                    }
                };

                if(docs.length > 0)
                    if("lastmodified" in docs[0])
                        if(typeof docs[0]["lastmodified"] === "number")
                            options.headers["If-Modified-Since"] = new Date(parseInt(docs[0]["lastmodified"])).toGMTString();

                var req = protocol.request(options, function(res) {
                    if(res.statusCode === 200){
                        //If Last Modified Header
                        if("last-modified" in res.headers){
                            var lastModifiedString = res.headers["last-modified"];
                            var lastModified = new Date(lastModifiedString).getTime();
                            var cacheETAG = ("etag" in res.headers) ? res.headers["etag"] : null;

                            if(typeof cacheETAG === "string")
                                cacheETAG = cacheETAG.replace(/\"/g, "");

                            if(docs.length > 0){
                                if(docs[0]["lastmodified"] > 0){
                                    if(lastModified > docs[0]["lastmodified"]){
                                        console.log(id+" Modified");
                                        HorusEyes.db.collection("links").update({"_id": id}, {$set: {lastmodified: lastModified, etag: cacheETAG}});
                                    }
                                    else{
                                        console.log(id+" Not modified");
                                        HorusEyes.db.collection("links").update({"_id": id}, {$set: {lastwatch: now.getTime()}});
                                    }
                                }
                                else{
                                    HorusEyes.db.collection("links").update({"_id": id}, {$set: {lastmodified: lastModified, etag: cacheETAG}});
                                }
                            }
                            else{
                                HorusEyes.db.collection("links").update({"_id": id}, {$set: {lastmodified: lastModified, etag: cacheETAG}});
                            }
                        }
                        else{
                            var optionsGet = {
                                host: urlArr.host,
                                path: urlArr.path,
                                port: port,
                                method: 'GET',
                                headers: {
                                    "Accept": "*/*",
                                    "User-Agent": "Horus",
                                    "Content-Type": "text/plain; charset=utf-8",
                                    "Accept-Language": "pt-BR,pt;q=0.8,en-US;q=0.6,en;q=0.4",
                                }
                            };

                            if(docs.length > 0)
                                if("lastmodified" in docs[0])
                                    if(docs[0]["lastmodified"] > 0)
                                        optionsGet.headers["If-Modified-Since"] = new Date(parseInt(docs[0]["lastmodified"])).toGMTString();

                            var reqGet = protocol.request(optionsGet, function(resGet){
                                var tmpBuffer = "";

                                res.on('error', function(error) {
                                    console.log(error);
                                });

                                res.on('data', function(chunk) {
                                    tmpBuffer += chunk;
                                });

                                res.on('end', function(chunk) {                                
                                    if(resGet.statusCode === 200){
                                        var eTag = md5(tmpBuffer);

                                        if(docs.length > 0){
                                            if("etag" in docs[0]){
                                                if(docs[0]["etag"] !== eTag){
                                                    console.log(id+" Modified");
                                                    HorusEyes.db.collection("links").update({"_id": id}, {$set: {lastmodified: now.getTime(), lastwatch: now.getTime(), etag: eTag}});
                                                }                                            
                                                else{
                                                    console.log(id+" Not modified");
                                                    HorusEyes.db.collection("links").update({"_id": id}, {$set: {lastwatch: now.getTime()}});
                                                }
                                            }
                                            else{
                                                console.log(id+" First watch");                                    
                                                HorusEyes.db.collection("links").update({"_id": id}, {$set: {lastmodified: now.getTime(), lastwatch: now.getTime(), etag: md5(tmpBuffer)}});
                                            }
                                        }
                                        else{
                                            console.log(id+" First watch");                                    
                                            HorusEyes.db.collection("links").update({"_id": id}, {$set: {lastmodified: now.getTime(), lastwatch: now.getTime(), etag: md5(tmpBuffer)}});
                                        }
                                    }
                                    else if(resGet.statusCode === 304){
                                        console.log(id+" Not modified");
                                        HorusEyes.db.collection("links").update({"_id": id}, {$set: {lastwatch: now.getTime()}});
                                    }
                                    else{
                                        console.log(id+" Request error");
                                        HorusEyes.db.collection("links").update({"_id": id}, {$set: {invalid: true, code: res.statusCode, lastwatch: now.getTime()}});
                                    }

                                    global.gc();
                                });
                            });

                            reqGet.setTimeout(15000);
                            reqGet.end();
                        }                   
                    }
                    else if(res.statusCode === 304){
                        console.log(id+" Not modified");
                        HorusEyes.db.collection("links").update({"_id": id}, {$set: {lastwatch: now.getTime()}});
                    }
                    else{
                        console.log(id+" Request error");
                        HorusEyes.db.collection("links").update({"_id": id}, {$set: {invalid: true, code: res.statusCode, lastwatch: now.getTime()}});
                    }
                });

                req.setTimeout(3000);
                req.end();
            });    
        }
    }
};

process.on("message", function(data){
    switch(data.cmd){
        case "exit": process.exit(1); break;
        case "set": HorusEyes.set(data.id, data.link); break;
        case "delete": HorusEyes.set(data.id); break;
        case "settings": 
            settings = data;
            
            switch(settings.database.type){
                case "mongodb":                    
                    MongoServer.connect(settings.database.connstring, function(err, db){
                        HorusEyes.db = db;
                                              
                        if(err) process.send({"type": "error", "msg": "Eyes "+process.pid+": Error when trying to connect to MongoDB"})
                        else HorusEyes.init();
                    });
                break;
                default:
                    process.send({"type": "error", "msg": "Eyes "+process.pid+": The type of database selected is not supported, I do not know how you could do this more ok"});
                break;
            }    
        break;
    }
});