'use strict';

const roundOffFactor = 5*60*1000; // in milliseconds
var visualizations = {};
var currentVisualization;
var currentFilter;
var allConnections = [];
var userSettings;
try{
    userSettings = JSON.parse(localStorage.userSettings || '{}');
}catch(e){
    userSettings = {};
}
// FIXME: Read this from config file
var uploadServer = 'http://collusiondb-development.herokuapp.com/shareData';
var isRobot = false; // Used for spidering the web only
var uploadTimer;
var saveTimer;

// Constants for indexes of properties in array format
const SOURCE = 0;
const TARGET = 1;
const TIMESTAMP = 2;
const CONTENT_TYPE = 3;
const COOKIE = 4;
const SOURCE_VISITED = 5;
const SECURE = 6;
const SOURCE_PATH_DEPTH = 7;
const SOURCE_QUERY_DEPTH = 8;
const SOURCE_SUB = 9;
const TARGET_SUB = 10;
const METHOD = 11;
const STATUS = 12;
const CACHEABLE = 13;
const FROM_PRIVATE_MODE = 14;

var vizcanvas = document.querySelector('.vizcanvas');
var mapDocument, mapcanvas;
document.querySelector('.world-map').addEventListener('load', function(event){
  mapDocument = event.target.contentDocument;
  mapcanvas = mapDocument.querySelector('.mapcanvas');
  initMap();
}, false);


// DOM Utility

function elem(name, attributes, children){
   // name is the tagName of an element
   // [optional] attributes can be null or undefined, or an object of key/values to setAttribute on, attribute values can be functions to call to get the actual value
   // [optional] children can be an element, text or an array (or null or undefined). If an array, can contain strings or elements
   var e = document.createElement(name);
   var val;
   if (attributes && (Array.isArray(attributes) || attributes.nodeName || typeof attributes === 'string')){
        children = attributes;
        attributes = null;
   }
   try{
   if (attributes){
       Object.keys(attributes).forEach(function(key){
           if (attributes[key] === null || attributes[key] === undefined) return;
           if (typeof attributes[key] === 'function'){
               val = attributes[key](key, attributes);
               if (val){
                   e.setAttribute(key, val);
               }
           }else{
               e.setAttribute(key, attributes[key]);
           }
       });
   }
    }catch(e){
        console.log('attributes: not what we think they are: %o', attributes);
    }
   if (children){
       if (!Array.isArray(children)){
    children = [children]; // convenience, allow a single argument vs. an array of one
   }
   children.forEach(function(child){
          if (child.nodeName){
              e.appendChild(child);
          }else{
               // assumes child is a string
               e.appendChild(document.createTextNode(child));
           }
       });
   }
   return e;
};

window.addEventListener('load', function(evt){
    localStorage.numLaunch = parseInt(localStorage.numLaunch)+1 || 1;
    // Wire up events
    document.querySelector('[data-value=' + (localStorage.visualization || 'Graph') + ']').setAttribute("data-selected", true);
    var visualization = localStorage.visualization ? ( localStorage.visualization.toLowerCase() ) : "graph";
    switchVisualization(visualization);
    if ( localStorage.userHasOptedIntoSharing && localStorage.userHasOptedIntoSharing === 'true' ){
        startUploadTimer();
    }
    saveTimer = setInterval(saveConnections, 5 * 60 * 1000); // save to localStorage every 5 minutes    console.log('collusion load() ended');
});


window.addEventListener('beforeunload', function(){
    saveConnections(allConnections);
}, false);

function initCap(str){
    return str[0].toUpperCase() + str.slice(1);
}


function switchVisualization(name){
    // console.log('switchVisualizations(' + name + ')');
    saveConnections(allConnections);
    if (currentVisualization){
        if (currentVisualization === visualizations[name]) return;
        currentVisualization.emit('remove');
    }
    localStorage.visualization = initCap(name);
    currentVisualization = visualizations[name];
    resetAdditionalUI();
    addon.emit('uiready');
}




function resetAdditionalUI(){
    // toggle off info panel
    document.querySelector("#content").classList.remove("showinfo");
    var activeTab = document.querySelector(".info-panel-controls ul li.active");
    if ( activeTab ){ // make the active tab inactive, if any
        activeTab.classList.remove("active");
        activeTab.querySelector("img").classList.remove("hidden");
        activeTab.querySelector("i").classList.add("hidden");
    }
    // hide all help sections
    document.querySelector(".help-content .graph-view-help").classList.add("hidden");
    document.querySelector(".help-content .clock-view-help").classList.add("hidden");
    document.querySelector(".help-content .list-view-help").classList.add("hidden");
    // show vizcanvas again in case it is hidden
    document.querySelector(".vizcanvas").classList.remove("hide");
    // toggle footer section accordingly
    document.querySelector(".graph-footer").classList.add("hidden");
    document.querySelector(".clock-footer").classList.add("hidden");
    document.querySelector(".list-footer").classList.add("hidden");
    var vizName = currentVisualization.name;
    document.querySelector("." + vizName + "-footer").classList.remove("hidden");
}


/****************************************
*   Save connections
*/
function saveConnections(){
    // console.error('saveConnections( ' + allConnections.length + ' connection)');
    var lastSaved = Number(localStorage.lastSaved || 0);
    var unsavedNonPrivateConn = excludePrivateConnection(allConnections).filter(function(connection){
        // console.log(connection[TIMESTAMP] + ' > ' + lastSaved + ' (' + (connection[TIMESTAMP] > lastSaved) + ' [' + (typeof connection[TIMESTAMP]) + ']');
        return ( connection[TIMESTAMP] > lastSaved);
    });
    // console.error(unsavedNonPrivateConn.length + ' unsaved, non-private connections');
    if ( unsavedNonPrivateConn.length > 0 ){
        saveConnectionsByDate(unsavedNonPrivateConn);
    }
    localStorage.lastSaved = Date.now();
}


function saveConnectionsByDate(connections){
    var connByDateSet = {};
    var conn, key;
    // group connections by date
    for ( var i=0; i<connections.length; i++ ){
        conn = connections[i];
        key = dateAsKey( conn[TIMESTAMP] );
        if ( connByDateSet[key] ){
            connByDateSet[key].push(conn);
        }else{
            connByDateSet[key] = [conn];
        }
    }
    // save each group of connections to localStorage
    for(var date in connByDateSet){
        saveConnToLocalStorage(date,connByDateSet[date]);
    }
}


function saveConnToLocalStorage(date,connections){
    if ( !localStorage.getItem(date) ){
        saveToLocalStorage(date, JSON.stringify(connections));
    }else{
        saveToLocalStorage(date, localStorage.getItem(date).slice(0,-1) + "," + JSON.stringify(connections).slice(1,-1) + "]");
    }
}


function dateAsKey(timestamp){
    var theDate = new Date(timestamp);
    var year = theDate.getFullYear();
    var month = "00" + (theDate.getMonth()+1);
    var date = "00" + theDate.getDate();
    month = month.substr(-2); // fix the format
    date = date.substr(-2);
    return year+ "-" + month + "-" + date; // in the format of YYYY-MM-DD
}


/****************************************
*   Upload data
*/

function startSharing(askForConfirmation,callback){
    if ( askForConfirmation ){
        dialog( {   "name": dialogNames.startUploadData,
                    "title": "Upload Data", 
                    "message": 
                        '<p>You are about to start uploading de-identified information to our shared tracker database. ' +
                        'Your information will continue to be uploaded  until you turn off sharing. </p>' +
                        '<p>To learn more about uploading data, how it is de-identified, please read <a class="toggle-pp">the Lightbeam Privcy Policy</a>.</p>' + 
                        // Lightbeam Privacy Policy.
                        '<div class="privacy-policy collapsed">' +
                            '<header><b>Lightbeam Privacy</b></header>' +
                            '<div>We care about your privacy. Lightbeam is a browser add-on that collects and helps you visualize third party requests on any site you visit. If you choose to send Lightbeam data to Mozilla (that’s us), our privacy policy describes how we handle that data. </div>' +
                            '<br/>' + 
                            '<header><b>Things you should know</b></header>' +
                            '<ul>' +
                                '<li>' +
                                    'After you install Lightbeam, the add-on collects data to help you visualize third party requests when you visit sites.' + 
                                    '<ul>' +
                                        '<li>When you visit a site and that site contacts a third party, Lightbeam collects the following type of data: URLs of the visited sites and third parties, the existence of cookies, and a rough timestamp of when the site was visited. To see a complete list, please visit <a href="https://github.com/mozilla/lightbeam/blob/master/doc/data_format.v1.1.md" target="_blank" >here</a>.</li>' + 
                                    '</ul>' +
                                '</li>' +
                                '<li>By default, data collected by Lightbeam remains in your browser and is not sent to us. </li> ' +
                                '<li>' +
                                    'You can choose to contribute your Lightbeam data with us. Information from Lightbeam can help us and others to understand third party relationships on the web and promote further research in the field of online tracking and privacy.' + 
                                    '<ul>' +
                                        '<li>If you do contribute Lightbeam data with us, your browser will send us your de-identified Lightbeam data (you can see a list of the kind of data involved <a href="https://github.com/mozilla/lightbeam/blob/master/doc/data_format.v1.1.md" target="_blank">here</a>). We will post your data along with data from others in an aggregated and open database. Users will benefit by making more informed decisions based on the collective information and patterns about trackers.</li>' + 
                                        '<li>Uninstalling Lightbeam prevents collection of any further Lightbeam data and will delete the data stored locally in your browser.</li>' + 
                                    '</ul>' +
                                '</li> ' +
                            '</ul>' +
                        '</div>' +
                        // Lightbeam Privacy Policy ends
                        '</br>' +
                        '<p>By clicking OK, you are agreeing to the data practices in our privacy notice.</p>',
                    "imageUrl": "image/collusion_popup_warningsharing.png"
            },
            function(confirmed){
                if ( confirmed ){
                    localStorage.lastUpload = Date.now();
                    localStorage.userHasOptedIntoSharing = true;
                    sharingData();
                }
                callback(confirmed);
            }
        );
    }else{
        localStorage.lastUpload = Date.now();
        localStorage.userHasOptedIntoSharing = true;
        sharingData();
        callback(true);
    }
}

function stopSharing(callback){
    dialog( {   "name": dialogNames.stopUploadData,
                "title": "Stop Uploading Data", 
                "message": 
                    '<p>You are about to stop sharing information with our shared tracker database.</p>' +
                    '<p>By clicking OK you will no longer be uploading information.</p>',
                "imageUrl": "image/collusion_popup_stopsharing2.png"
            },
            function(confirmed){
                if ( confirmed ){
                    localStorage.userHasOptedIntoSharing = false;
                    if (uploadTimer){
                        clearTimeout(uploadTimer);
                        uploadTimer = null;
                    }
                }
                callback(confirmed);
            }
    );
}

function sharingData(){
    // console.log("Beginning Upload...");
    var lastUpload = localStorage.lastUpload;
    var connections = allConnections.filter(function(connection){
        return ( connection[TIMESTAMP] ) > lastUpload;
    });
    var data = exportFormat(connections,true); // round off timestamp
    var request = new XMLHttpRequest();
    request.open("POST", uploadServer, true);
    request.setRequestHeader("Collusion-Share-Data","collusion");
    request.setRequestHeader("Content-type","application/json");
    request.send(data);
    request.onload = function(){
        console.log(this.responseText);
        if (this.status === 200){
            localStorage.lastUpload = Date.now();
        }
    };
    request.onerror = function(){
        console.log("Share data attempt failed.");
    };
    startUploadTimer();
}

function startUploadTimer(){
    localStorage.lastUpload = Date.now();
    uploadTimer = setTimeout(sharingData, 10 * 60 * 1000); // upload every 10 minutes
}

// Save user settings on exit
window.addEventListener('beforeunload', function(event){
    // don't need to store empty settings
    Object.keys(userSettings).forEach(function(key){
        if (!userSettings[key]){
            delete userSettings[key];
        } 
    });
    localStorage.userSettings = JSON.stringify(userSettings);
}, false);

function saveToLocalStorage(key,value){
    try{
        localStorage.setItem(key,value);
    }catch(error){
        console.log(error);
        if ( error.code == 1014 ){ // QUOTA_EXCEEDED_ERR
            console.log("localStorage reaches its quota, deleting the oldest connections set.");
            var dateKeyArray = [];
            Object.keys(localStorage).sort().forEach(function(key){
                if ( key.charAt(0) == "2" ){ // date keys are in the format of yyyy-mm-dd
                    dateKeyArray.push(key);
                }
            });
            if ( dateKeyArray.length == 0 ){ // exceed localStorage quota and there are no more connections can be deleted
                console.log("[ Error ] Failed to store data to localStorage.");
                return;
            }
            localStorage.removeItem( dateKeyArray.shift() );
            saveToLocalStorage(key,value); // try saving again
        }
    }
}


/****************************************
*   Format date string
*/
function formattedDate(date,format){
    var d = ( typeof date == "number" ) ? new Date(date) : date;
    var month = [ "Jan", "Feb", "Mar", "Apr", "May", "June", "July", "Aug", "Sept", "Oct", "Nov", "Dec" ][d.getMonth()];
    var formatted = month + " " + d.getDate() + ", " + d.getFullYear();
    if ( format == "long" ){
        var dayInWeek = [ "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat" ][d.getDay()];
        formatted = dayInWeek + ", " + formatted + " " +  ( (d.getHours() == 12) ? 12 : (d.getHours() % 12) ) + ':' + d.toLocaleFormat('%M') + ['AM','PM'][Math.floor(d.getHours() / 12)];
    }
    return formatted;
}


/****************************************
*   update Stats Bar
*/
function updateStatsBar(){
    var dateSince = "just now";
    if ( allConnections.length > 0 ){
        dateSince = formattedDate(allConnections[0][2]);
    }
    document.querySelector(".top-bar .date-gathered").innerHTML = dateSince;
    document.querySelector(".top-bar .third-party-sites").innerHTML = aggregate.trackerCount + " " + singularOrPluralNoun(aggregate.trackerCount,"THIRD PARTY SITE"); 
    document.querySelector(".top-bar .first-party-sites").innerHTML = aggregate.siteCount  + " " + singularOrPluralNoun(aggregate.siteCount,"SITE");
}
