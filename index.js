var request = require("request");
var inherits = require('util').inherits;
var Accessory, Service, Characteristic, UUIDGen;
var wait_timeout = 1000

module.exports = function(homebridge) {
   Accessory = homebridge.platformAccessory;
   Service = homebridge.hap.Service;
   Characteristic = homebridge.hap.Characteristic;
   UUIDGen = homebridge.hap.uuid;

    AlphaDisplay = function() {
      Characteristic.call(this, 'Alpha Display', '9f9a83ec-58c8-41e4-9e60-f3ab978d5663');
      this.setProps({
        format: Characteristic.Formats.STRING,
        perms: [Characteristic.Perms.READ]
      });
      this.value = this.getDefaultValue();
    };
   fixInheritance(AlphaDisplay, Characteristic);


   homebridge.registerPlatform("homebridge-ademco", "Ademco", AdemcoPlatform, true);
}

// Necessary because Accessory is defined after we have defined all of our classes
function fixInheritance(subclass, superclass) {
    var proto = subclass.prototype;
    inherits(subclass, superclass);
    subclass.prototype.parent = superclass.prototype;
    for (var mn in proto) {
        subclass.prototype[mn] = proto[mn];
    }
}


function AdemcoPlatform(log, config, api) {
   this.log = log;
   this.config = config || {
      "platform": "Ademco"
   };
   this.deviceManufacturer = this.config.manufacturer || "Honeywell";
   this.deviceModel = this.config.model || "Vista 20p";
   this.deviceSerial = "1.0";

   this.pin = this.config.pin;
   this.alarmserver = this.config.alarmserver || "http://localhost:8111";
   this.args = this.config.args || "";
   this.longPoll = parseInt(this.config.longPoll, 10) || 300;
   this.shortPoll = parseInt(this.config.shortPoll, 10) || 5;
   this.shortPollDuration = parseInt(this.config.shortPollDuration, 10) || 120;
   this.tout = null;
   this.maxCount = this.shortPollDuration / this.shortPoll;
   this.count = this.maxCount;
   this.validData = false;
   this.accessories = {};
   this.alarmzones = this.config.zones;


   if (api) {
      this.api = api;
      this.api.on('didFinishLaunching', this.didFinishLaunching.bind(this));
   }

   // Definition Mapping
   this.alarmState = ["Stay", "Away", "Night", "Disarmed", "Triggered"];
}

// Method to restore accessories from cache
AdemcoPlatform.prototype.configureAccessory = function(accessory) {
   this.setService(accessory);
   var accessoryID = accessory.context.deviceID;
   this.accessories[accessoryID] = accessory;
}

// Method to setup accesories from config.json
AdemcoPlatform.prototype.didFinishLaunching = function() {
   if (this.pin) {
      // Add or update accessory in HomeKit
      this.addAccessory();

      // Start polling
      this.periodicUpdate();
   } else {
      this.log("[Ademco] Please set Ademco pin!")
   }
}

// Method to add or update HomeKit accessories
AdemcoPlatform.prototype.addAccessory = function() {
   var self = this;

   self.getAlarmStatus(function(error) {
      if (!error) {

         // parse and interpret the response
         self.log("[Ademco] is online.");
         for (var deviceID in self.accessories) {
            var accessory = self.accessories[deviceID];
            if (!accessory.reachable) {
               // Remove extra accessories in cache
               self.removeAccessory(accessory);
            } else {
               // Update initial state
               self.updateAlarmStates(accessory);
            }
         }
      } else {
         self.log("[Ademco] Error '" + error + "' logging in to Envisalink: ");
         callback(error);
      }
   });

}

// Method to remove accessories from HomeKit
AdemcoPlatform.prototype.removeAccessory = function(accessory) {
   if (accessory) {
      var deviceID = accessory.context.deviceID;
      this.log("[" + accessory.displayName + "] Removed from HomeBridge.");
      this.api.unregisterPlatformAccessories("homebridge-ademco", "Ademco", [accessory]);
      delete this.accessories[deviceID];
   }
}

// Method to setup listeners for different events
AdemcoPlatform.prototype.setService = function(accessory, type=null) {

   accessory
      .getService(Service.SecuritySystem)
      .getCharacteristic(Characteristic.SecuritySystemCurrentState)
      .on('get', this.getCurrentState.bind(this, accessory));


   accessory
      .getService(Service.SecuritySystem)
      .getCharacteristic("Alpha Display")
      .on('get', this.getAlphaDisplay.bind(this, accessory));


   accessory
      .getService(Service.SecuritySystem)
      .getCharacteristic(Characteristic.SecuritySystemTargetState)
      .on('get', this.getTargetState.bind(this, accessory))
      .on('set', this.setTargetState.bind(this, accessory));

   accessory.on('identify', this.identify.bind(this, accessory));
	
}

// Method to setup HomeKit accessory information
AdemcoPlatform.prototype.setAccessoryInfo = function(accessory) {

      accessory
         .getService(Service.AccessoryInformation)
         .setCharacteristic(Characteristic.Manufacturer, this.deviceManufacturer)
         .setCharacteristic(Characteristic.SerialNumber, this.deviceSerial)
         .setCharacteristic(Characteristic.Model, this.deviceModel);

}

// Method to set target alarm state
AdemcoPlatform.prototype.setTargetState = function(accessory, state, callback) {
   var self = this;
   self.setState(accessory, state, function(setStateError) {

      callback(setStateError);
   });
}

// Method to get target alarm state
AdemcoPlatform.prototype.getTargetState = function(accessory, callback) {
   // Get target state directly from cache
   var self = this;
   callback(null, accessory.context.currentState);
}


// Method to get target alarm state
AdemcoPlatform.prototype.getAlphaDisplay = function(accessory, callback) {
   // Get target state directly from cache
   var self = this;
   callback(null, accessory.context.alpha_display);
}


// Method to get current alarm state
AdemcoPlatform.prototype.getCurrentState = function(accessory, callback) {
   var self = this;
   var thisAlarm = accessory.context;
   var name = accessory.displayName;

   // Retrieve latest state from server
   this.updateState(function(error) {
      if (!error) {
         self.log("[" + name + "] Getting current state: " + self.alarmState[thisAlarm.currentState]);
         callback(null, thisAlarm.currentState);

      } else {
         callback(error);
      }
   });
}

// Method for state periodic update
AdemcoPlatform.prototype.periodicUpdate = function() {
   var self = this;
   // Determine polling interval
   if (this.count < this.maxCount) {
      this.count++;
      var refresh = this.shortPoll;
   } else {
      var refresh = this.longPoll;
   }

   // Setup periodic update with polling interval
   this.tout = setTimeout(function() {
      self.tout = null
      self.updateState(function(error) {

         if (!error) {
            // Update states for all HomeKit accessories
            for (var deviceID in self.accessories) {
               var accessory = self.accessories[deviceID];
               self.updateAlarmStates(accessory);
            }
         } else {
            self.count = self.maxCount - 1;
         }

         // Setup next polling
         self.periodicUpdate();
      });
   }, refresh * 1000);
}

// Method to update state in HomeKit
AdemcoPlatform.prototype.updateAlarmStates = function(accessory) {
       accessory
          .getService(Service.SecuritySystem)
          .setCharacteristic(Characteristic.SecuritySystemCurrentState, accessory.context.currentState);

       accessory
          .getService(Service.SecuritySystem)
          .setCharacteristic(Characteristic.ObstructionDetected, accessory.context.obstruction_detected);

       accessory
          .getService(Service.SecuritySystem)
          .setCharacteristic("Alpha Display", accessory.context.alpha_display);

       accessory
          .getService(Service.SecuritySystem)
          .getCharacteristic(Characteristic.SecuritySystemTargetState)
          .getValue();


}

// Method to retrieve alarm state from the server
AdemcoPlatform.prototype.updateState = function(callback) {

   var self = this;

   this.getAlarmStatus(function(error) {
      callback(error);
   });

}

// Method to handle identify request
AdemcoPlatform.prototype.identify = function(accessory, paired, callback) {
   this.log("[" + accessory.displayName + "] Identify requested!");
   callback();
}


// Set up characteristics of the alarm.
AdemcoPlatform.prototype.getAlarmStatus = function(callback) {

   var self = this;

   // Reset validData hint until we retrived data from the server
   this.validData = false;

   request.get({
      method: "GET",
      url: this.alarmserver + "/api/"
   }, function(err, response, body) {
      if (!err && response.statusCode == 200) {
         try {
            var alarm_status = JSON.parse(body);
            var partitions = alarm_status["partition"];

            for (partition in partitions) {
               if (partition == "lastevents") continue;

               var thisAlarmID = partitions[partition].name.toString();

               var thisAlarmState = Characteristic.SecuritySystemCurrentState.DISARMED;

               if (!self.accessories[thisAlarmID]) {
                  var uuid = UUIDGen.generate(thisAlarmID);

                  // Alarm system type
                  var newAccessory = new Accessory("Ademco " + thisAlarmID, uuid, 11);

                  // New accessory found in the server is always reachable
                  newAccessory.reachable = true;
                  newAccessory.context.deviceID = thisAlarmID;
                  newAccessory.context.initialState = Characteristic.SecuritySystemCurrentState.DISARMED;
                  newAccessory.context.currentState = Characteristic.SecuritySystemCurrentState.DISARMED;
                  newAccessory.addService(Service.SecuritySystem, thisAlarmID);

                  newAccessory.context.obstruction_detected = false;
                  newAccessory.getService(Service.SecuritySystem)
                    .addCharacteristic(Characteristic.ObstructionDetected);


                  newAccessory.context.alpha_display = "";
                  newAccessory.getService(Service.SecuritySystem)
                    .addCharacteristic(AlphaDisplay);

                  // Setup HomeKit accessory information
                  self.setAccessoryInfo(newAccessory);

                  // Setup listeners for different security system events
                  self.setService(newAccessory);

                  // Register accessory in HomeKit
                  self.api.registerPlatformAccessories("homebridge-ademco", "Ademco", [newAccessory]);
               } else {
                  var newAccessory = self.accessories[thisAlarmID];
                  // Accessory is reachable after it's found in the server
                  newAccessory.updateReachability(true);

               }

               for (k in partitions[partition].status) {
                  val = partitions[partition].status[k];
                  switch (k) {
                     case "armed_stay":
                        if (val == true) thisAlarmState = Characteristic.SecuritySystemCurrentState.STAY_ARM;
                        break;
                     case "armed_away":
                        if (val == true) thisAlarmState = Characteristic.SecuritySystemCurrentState.AWAY_ARM;
                        break;
                     case "armed":
                        if (val == false) thisAlarmState = Characteristic.SecuritySystemCurrentState.DISARMED;
                        break;
                     case "ready":
                        newAccessory.context.ready = val;
			            break;
                    case "alpha":
                        newAccessory.context.alpha_display = val;
                        break;
                  }
               }
               newAccessory.context.obstruction_detected = (newAccessory.context.ready == false && thisAlarmState == Characteristic.SecuritySystemCurrentState.DISARMED);

               var zone_status = alarm_status["zone"];
               newAccessory.context.status_fault = 0;

               for (zone in zone_status) {

                  var zone_name = zone_status[zone].name;
                  var zone_fault = zone_status[zone].fault;
                  var zone_open = zone_status[zone].open;

                  if (zone_fault) {
                            newAccessory.context.status_fault = zone;
                            self.log("Zone " + zone_name + " (" + zone + ") is active.");
                            break;
                          }

               }

               // Detect for state changes
               if (thisAlarmState != newAccessory.context.currentState) {
                  self.count = 0;
                  newAccessory.context.currentState = thisAlarmState;
               }

               // Store accessory in cache
               self.accessories[thisAlarmID] = newAccessory;

               // Set validData hint after we found an opener
               self.validData = true;


            }

         } catch (err) {
            self.log("[Ademco] Error '" + err + "'");
         }
         // Did we have valid data?
         if (self.validData) {
            // Set short polling interval when state changes
            if (self.tout && self.count == 0) {
               clearTimeout(self.tout);
               self.periodicUpdate();
            }
            callback();
         } else {
            self.log("[Ademco] Error: Couldn't find a Ademco alarm.");
            callback("Missing Ademco state information");
         }

      } else {
         self.log("[Ademco] Error '" + err + "' getting Ademco partitions " + body);
         callback(err);
      }
   }).on('error', function(err) {
      self.log("[Ademco] Error '" + err + "'");
      callback(err);
   });
}

// Send opener target state to the server
AdemcoPlatform.prototype.setState = function(accessory, state, callback) {

   var self = this;
   var thisAlarm = accessory.context;
   var name = accessory.displayName;
   var targetAlarmState = "";

   switch (state) {
      case Characteristic.SecuritySystemCurrentState.DISARMED:
         targetAlarmState = "disarm";
         break;

      case Characteristic.SecuritySystemCurrentState.AWAY_ARM:
         targetAlarmState = "arm";
         break;

      case Characteristic.SecuritySystemCurrentState.STAY_ARM:
      case Characteristic.SecuritySystemCurrentState.NIGHT_ARM:
         targetAlarmState = "stayarm";
         break;

      default:
         targetAlarmState = "";
         break;
   }

   if (targetAlarmState == "") {
      callback("Error setting state to " + targetAlarmState);
      return;
   }

   // Querystring params
   var query = {
      alarmcode: this.pin
   };

   request.get({
      method: "GET",
      url: this.alarmserver + "/api/alarm/" + targetAlarmState,
      qs: query,
   }, function(err, response, json) {
      if (!err & response.statusCode == 200) {

         self.log("[" + name + "] State was successfully set to " + self.alarmState[state]);

         // Set short polling interval
         self.count = 0;
         if (self.tout) {
            clearTimeout(self.tout);
            self.periodicUpdate();
         }


         callback();

      } else {
         self.log("[" + name + "] Error '" + err + "' setting alarm state: " + JSON.stringify(json));
         callback(err);
      }
   }).on('error', function(err) {
      self.log("[" + name + "] " + err);
      callback(err);
   });

}

// Method to handle plugin configuration in HomeKit app
AdemcoPlatform.prototype.configurationRequestHandler = function(context, request, callback) {
   if (request && request.type === "Terminate") {
      return;
   }

   // Instruction
   if (!context.step) {
      var instructionResp = {
         "type": "Interface",
         "interface": "instruction",
         "title": "Before You Start...",
         "detail": "Please make sure homebridge is running with elevated privileges.",
         "showNextButton": true
      }

      context.step = 1;
      callback(instructionResp);
   } else {
      switch (context.step) {
         // Operation choices
         case 1:
            var respDict = {
               "type": "Interface",
               "interface": "input",
               "title": "Configuration",
               "secure": true,
               "items": [{
                  "id": "pin",
                  "title": "Alarm Pin (Required)",
                  "placeholder": this.pin ? "Leave blank if unchanged" : "pin"
               }, {
                  "id": "longPoll",
                  "title": "Long Polling Interval",
                  "placeholder": this.longPoll.toString(),
               }, {
                  "id": "shortPoll",
                  "title": "Short Polling Interval",
                  "placeholder": this.shortPoll.toString(),
               }, {
                  "id": "shortPollDuration",
                  "title": "Short Polling Duration",
                  "placeholder": this.shortPollDuration.toString(),
               }]
            }

            context.step = 2;
            callback(respDict);
            break;
         case 2:
            var userInputs = request.response.inputs;

            // Setup info for adding or updating accessory
            this.pin = userInputs.pin || this.pin;
            this.longPoll = parseInt(userInputs.longPoll, 10) || this.longPoll;
            this.shortPoll = parseInt(userInputs.shortPoll, 10) || this.shortPoll;
            this.shortPollDuration = parseInt(userInputs.shortPollDuration, 10) || this.shortPollDuration;
            this.deviceManufacturer = this.config.manufacturer || "Honeywell";
            this.deviceModel = this.config.model || "Vista 20p";
            this.deviceSerial = this.config.serial || "1.0";
            this.pin = this.config.pin;
            this.alarmserver = this.config.alarmserver || "http://localhost:8111";

            // Check for required info
            if (this.pin) {
               // Add or update accessory in HomeKit
               this.addAccessory();

               // Reset polling
               this.maxCount = this.shortPollDuration / this.shortPoll;
               this.count = this.maxCount;
               if (this.tout) {
                  clearTimeout(this.tout);
                  this.periodicUpdate();
               }

               var respDict = {
                  "type": "Interface",
                  "interface": "instruction",
                  "title": "Success",
                  "detail": "The configuration is now updated.",
                  "showNextButton": true
               };

               context.step = 3;
            } else {
               // Error if required info is missing
               var respDict = {
                  "type": "Interface",
                  "interface": "instruction",
                  "title": "Error",
                  "detail": "Some required information is missing.",
                  "showNextButton": true
               };

               context.step = 1;
            }
            callback(respDict);
            break;
         case 3:
            // Update config.json accordingly
            delete context.step;
            var newConfig = this.config;
            newConfig.pin = this.pin;
            newConfig.longPoll = this.longPoll;
            newConfig.shortPoll = this.shortPoll;
            newConfig.shortPollDuration = this.shortPollDuration;

            callback(null, "platform", true, newConfig);
            break;
      }
   }
}
