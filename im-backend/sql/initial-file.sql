INSERT INTO `ankowhm`.`user_role` (`RoleName`, `RoleLevel`, `RoleArea`) VALUES ('admin', 'admin', NULL);
INSERT INTO `ankowhm`.`user_role` (`RoleName`, `RoleLevel`, `RoleArea`) VALUES ('featuretest', 'associate', NULL);
INSERT INTO `ankowhm`.`user_role` (`RoleName`, `RoleLevel`, `RoleArea`) VALUES ('s_basicaccess', 'associate', 'STR');
INSERT INTO `ankowhm`.`user_role` (`RoleName`, `RoleLevel`, `RoleArea`) VALUES ('s_bulkstow', 'associate', 'STR');
INSERT INTO `ankowhm`.`user_role` (`RoleName`, `RoleLevel`, `RoleArea`) VALUES ('s_inventorycount', 'associate', 'STR');
INSERT INTO `ankowhm`.`user_role` (`RoleName`, `RoleLevel`, `RoleArea`) VALUES ('s_manager', 'manager', 'STR');
INSERT INTO `ankowhm`.`user_role` (`RoleName`, `RoleLevel`, `RoleArea`) VALUES ('w_bulkstow', 'associate', 'WRH');
INSERT INTO `ankowhm`.`user_role` (`RoleName`, `RoleLevel`, `RoleArea`) VALUES ('w_driver', 'associate', 'WRH');
INSERT INTO `ankowhm`.`user_role` (`RoleName`, `RoleLevel`, `RoleArea`) VALUES ('w_inventorycount', 'associate', 'WRH');
INSERT INTO `ankowhm`.`user_role` (`RoleName`, `RoleLevel`, `RoleArea`) VALUES ('w_inventorycountcase', 'associate', 'WRH');
INSERT INTO `ankowhm`.`user_role` (`RoleName`, `RoleLevel`, `RoleArea`) VALUES ('w_manager', 'manager', 'WRH');
INSERT INTO `ankowhm`.`user_role` (`RoleName`, `RoleLevel`, `RoleArea`) VALUES ('w_online_manager', 'manager', 'WRH');
INSERT INTO `ankowhm`.`user_role` (`RoleName`, `RoleLevel`, `RoleArea`) VALUES ('w_onlineorders', 'associate', 'WRH');
INSERT INTO `ankowhm`.`user_role` (`RoleName`, `RoleLevel`, `RoleArea`) VALUES ('w_pack', 'associate', 'WRH');
INSERT INTO `ankowhm`.`user_role` (`RoleName`, `RoleLevel`, `RoleArea`) VALUES ('w_pick', 'associate', 'WRH');
INSERT INTO `ankowhm`.`user_role` (`RoleName`, `RoleLevel`, `RoleArea`) VALUES ('w_pickcase', 'associate', 'WRH');
INSERT INTO `ankowhm`.`user_role` (`RoleName`, `RoleLevel`, `RoleArea`) VALUES ('w_receive', 'associate', 'WRH');
INSERT INTO `ankowhm`.`user_role` (`RoleName`, `RoleLevel`, `RoleArea`) VALUES ('w_receivecase', 'associate', 'WRH');
INSERT INTO `ankowhm`.`user_role` (`RoleName`, `RoleLevel`, `RoleArea`) VALUES ('w_removeinventory', 'associate', 'WRH');
INSERT INTO `ankowhm`.`user_role` (`RoleName`, `RoleLevel`, `RoleArea`) VALUES ('w_stow', 'associate', 'WRH');
INSERT INTO `ankowhm`.`user_role` (`RoleName`, `RoleLevel`, `RoleArea`) VALUES ('w_stowcase', 'associate', 'WRH');
INSERT INTO `ankowhm`.`user_role` (`RoleName`, `RoleLevel`, `RoleArea`) VALUES ('w_troubleshoot', 'associate', 'WRH');

INSERT INTO `ankowhm`.`user` (`ID`, `Username`, `FirstName`, `LastName`, `AccountCreated`, `PasswordHash`, `IsDeleted`)                                                         VALUES ('1', 'system_user', '_system_', '_user_', '0000-00-00 00:00:00', '', '0');
INSERT INTO `ankowhm`.`user` (`ID`, `Username`, `FirstName`, `LastName`, `Email`, `PhoneNumber`, `AccountCreated`, `PasswordHash`, `DefaultLocation`, `Locations`, `IsDeleted`) VALUES ('2', 'admin', 'Admin', 'Admin', 'admin@anko.com', '555-555-5555', '0000-00-00 00:00:00', '$2a$10$xzXRQejya.7Z8xUC5zZpseLYmoGqraqMgV2kixIF6g8yXPIS7mpim', 'TST1-STR', 'TST1-STR,TST1-WRH', '0');
UPDATE `ankowhm`.`user` SET `ID` = '0' WHERE (`ID` = '1');
UPDATE `ankowhm`.`user` SET `ID` = '1' WHERE (`ID` = '2');
ALTER TABLE `ankowhm`.`user` AUTO_INCREMENT = 2;

INSERT INTO user(Username, LoginBarcode, Firstname, LastName, Email, PasswordHash, DefaultLocation, Locations) Values
('jvetyska', 'rjfsl5_wd76Pk', 'Jiri', 'Vetyska', 'jiri.vetyska@anko.com', '$2a$10$e7yVAraRCwcgQ33gTm71YOafd4id/Mk6gAMs0wR04869Ii8EEfE7y', 'TST1-STR', 'TST1-STR,TST1-WRH'),
('leif.coleman', 'abcdefghijklm', 'Leif', 'Coleman', 'leif.coleman@anko.com', '$2a$10$JNrWkUc6YQRjMVY8nYpMn.ioDp9phStTQvc3crj6uKcR8c2.llIdi', 'TST1-STR', 'TST1-STR,TST1-WRH'),
('rudy', 'loXRu4b2T7s0J', 'Rudy', 'Darmawan', 'rudy.darmawan@anko.com','$2a$10$6x0Io715HCgYRHPCYhcxAOfCPkSqGWyDvmqPtV6nAgtNok2O1kUpe','TST1-STR', 'TST1-STR,TST1-WRH'),
( 'saritdas', 'ankoengineering', 'Sarit', 'Das', 'sarit.das@anko.com', '$2a$10$4IQJfUw5r8LhChc3tddUmO9Fca28qGq4MyG5CHsh/3RcwEqbfG0Wi','TST1-STR', 'TST1-STR,TST1-WRH'),
('glenluengen', 'DIdzOzN5H6F0Z', 'Glen', 'Luengen', 'glen.luengen@anko.com', '$2a$10$qE/GDfYz1Yh/NY0WpglgwuYFdqBqB6KgUY8/T4J5NSmOQxO6RT5Tm', 'TST1-STR', 'TST1-STR,TST1-WRH'),
('josh.mcmorris', NULL, 'Josh', 'McMorris', 'josh.mcmorris@anko.com','$2a$10$v46HiaK9/BRNnFZ0g6iB3.VF9JZoNyec8OM8I4hvixOyu/9wgCXBe', 'TST1-STR', 'TST1-STR,TST1-WRH'),
('jolly.patel', 'QXPv1mt-eTC6x', 'Jolly', 'Patel', 'jolly.patel@anko.com', '$2a$10$sW9pBPAEnEneZm9lOC7lieUpIZfGnAvHtjoH6rsXIhyTSQGdUXF7y', 'TST1-STR', 'TST1-STR,TST1-WRH');

INSERT INTO user_roles (UserID, UserRole, AddedBy) VALUES (1, 'admin', 0), (2, 'admin', 0), (3, 'admin', 0), (4, 'admin', 0), (5, 'admin', 0), (6, 'admin', 0), (7, 'admin', 0), (8, 'admin', 0);

INSERT INTO `ankowhm`.`location` (`ID`, `Name`, `Timezone`, `InternalName`, `Address`, `City`, `State`, `Zip`, `PhoneNumber`, `HoursOfOperation`, `IsOpen`, `DaysOfCoverage`, `isReplenishedByMDU`, `DateOpen`, `DisplayOrder`, `WarehouseID`, `OffsetMinutes`, `OffsetMinutesFasttrack`, `UseDelivery`, `DeliveryMinutes`, `isInventoryCounted`, `isCrossDockEnabled`, `isArchived`, `hasFHBH`, `isISPEnabled`) VALUES ('TST1-STR', 'API Test Store', 'US/Pacific', 'API Test Warehouse', '123 Sesame Street', 'Seattle', 'WA', '98001', '800-555-1212', '24/7', '0', '4.00', '0', '2019-07-02 07:00:00', '1', 'TST1-WRH', '0', '0', '1', '0', '0', '0', '0', '1', '0');
INSERT INTO `ankowhm`.`location` (`ID`, `Name`, `Timezone`, `InternalName`, `Address`, `City`, `State`, `Zip`, `PhoneNumber`, `HoursOfOperation`, `IsOpen`, `DaysOfCoverage`, `isReplenishedByMDU`, `DateOpen`, `DisplayOrder`, `OffsetMinutes`, `OffsetMinutesFasttrack`, `UseDelivery`, `DeliveryMinutes`, `isInventoryCounted`, `isCrossDockEnabled`, `isArchived`, `hasFHBH`, `isISPEnabled`) VALUES ('TST1-WRH', 'API Test Warehouse DC', 'US/Pacific', 'API Test Warehouse DC', '123 Sesame Street', 'Seattle', 'WA', '98001', '800-555-12121', '24/7', '0', '4.00', '0', '2019-06-15 07:00:00', '0', '0', '0', '1', '0', '0', '0', '1', '0', '0');

INSERT INTO `ankowhm`.`container` (`ID`, `Type`, `Priority`, `ParentID`, `LocationID`, `isApparel`) VALUES ('TST1-CRT', 'CRT', '1', 'TST1-WRH', 'TST1-WRH', 'Standard');
INSERT INTO `ankowhm`.`container` (`ID`, `Type`, `Priority`, `ParentID`, `LocationID`, `isApparel`) VALUES ('TST1-RSV-0001', 'RSV', '1', 'TST1-WRH', 'TST1-WRH', 'Standard');
INSERT INTO `ankowhm`.`container` (`ID`, `Type`, `Priority`, `ParentID`, `LocationID`, `isApparel`) VALUES ('TST1-RSV-0002', 'RSV', '1', 'TST1-WRH', 'TST1-WRH', 'Standard');
INSERT INTO `ankowhm`.`container` (`ID`, `Type`, `Priority`, `ParentID`, `LocationID`, `isApparel`) VALUES ('TST1-RSV-0003', 'RSV', '1', 'TST1-WRH', 'TST1-WRH', 'Standard');
INSERT INTO `ankowhm`.`container` (`ID`, `Type`, `Priority`, `ParentID`, `LocationID`, `isApparel`) VALUES ('TST1-SHL', 'SHL', '1', 'TST1-WRH', 'TST1-WRH', 'Standard');
INSERT INTO `ankowhm`.`container` (`ID`, `Type`, `Priority`, `LocationID`, `isApparel`) VALUES ('TST1-STR', 'STR', '1', 'TST1-STR', 'Standard');
INSERT INTO `ankowhm`.`container` (`ID`, `Type`, `Priority`, `ParentID`, `LocationID`, `isApparel`) VALUES ('TST1-STR-CRT', 'CRT', '1', 'TST1-STR', 'TST1-STR', 'Standard');
INSERT INTO `ankowhm`.`container` (`ID`, `Type`, `Priority`, `ParentID`, `LocationID`, `isApparel`) VALUES ('TST1-STR-DMG', 'OTH', '1', 'TST1-STR', 'TST1-STR', 'Standard');
INSERT INTO `ankowhm`.`container` (`ID`, `Type`, `Priority`, `ParentID`, `LocationID`, `isApparel`) VALUES ('TST1-STR-MOD', 'MOD', '1', 'TST1-STR', 'TST1-STR', 'Standard');
INSERT INTO `ankowhm`.`container` (`ID`, `Type`, `Priority`, `ParentID`, `LocationID`, `isApparel`) VALUES ('TST1-STR-RCV', 'RCV', '1', 'TST1-STR', 'TST1-STR', 'Standard');
INSERT INTO `ankowhm`.`container` (`ID`, `Type`, `Priority`, `ParentID`, `LocationID`, `isApparel`) VALUES ('TST1-STR-RSV', 'RSV', '1', 'TST1-STR', 'TST1-STR', 'Standard');
INSERT INTO `ankowhm`.`container` (`ID`, `Type`, `Priority`, `ParentID`, `LocationID`, `isApparel`) VALUES ('TST1-STR-SHL', 'SHL', '1', 'TST1-STR', 'TST1-STR', 'Standard');
INSERT INTO `ankowhm`.`container` (`ID`, `Type`, `Priority`, `ParentID`, `LocationID`, `isApparel`) VALUES ('TST1-TOT', 'TOT', '1', 'TST1-WRH', 'TST1-WRH', 'Standard');
INSERT INTO `ankowhm`.`container` (`ID`, `Type`, `Priority`, `LocationID`) VALUES ('TST1-WRH', 'WRH', '1', 'TST1-WRH');

INSERT INTO container_type(ID, SubType, Description, isFoH, isBoH, isWRH, isOffsite, isSystemInv, BackfillEnabled, Priority, DisplayOrder) VALUES
  ("STR",null,"Store","1",null,null,null,1,"1",1,1),
  ("SHL",null,"Shelf",null,"1","1",null,1,"1",1,3),
  ("SHL","BOH","Back of house",null,"1",null,null,1,"1",1,3),
  ("SHL","MEZ","Mezzamine level",null,"1","1",null,1,"1",1,3),
  ("RCV","FIT","Fitting Rooms",null,"1",null,null,1,"1",1,5),
  ("RCV",null,"Receive",null,"1","1",null,1,null,1,5),
  ("RCV","DEC","Decanting Station",null,"1","1",null,1,null,1,5),
  ("RCV","RET","Returns",null,"1","1",null,1,null,1,5),
  ("RCV","RLO","RLO", null, 1, null,null,1, null, 1, 5),
  ("RSV",null,"Reserve",null,"1","1",null,1,"1",2,4),
  ("RSV","RAC","High Racks",null,"1","1",null,1,"1",2,4),
  ("RSV","OFF","Offsite",null,"1","1","1",1,"1",3,4),
  ("OTH",null,"Other","1","1","1",null,0,null,1,7),
  ("OTH","CNC","Click & Collect","1","1","1",null,0,null,1,7),
  ("OTH","ONL","Online Orders","1","1","1",null,0,null,1,7),
  ("OTH","DMG","Damages","1","1","1",null,0,null,1,7),
  ("CRT",null,"Cart",null,"1","1",null,0,null,1,6);

INSERT INTO `ankowhm`.`system_settings` (`Property`, `Category`, `Value`, `DateCreated`, `DateUpdated`) VALUES ('DCOrderDays', 'PDU', '4', '2020-05-27 22:19:01', '2020-05-27 22:19:01');
INSERT INTO `ankowhm`.`system_settings` (`Property`, `Category`, `Value`, `DateCreated`, `DateUpdated`) VALUES ('factor_OOS', 'replenish', '1', '2020-05-27 22:19:01', '2020-05-27 22:19:01');
INSERT INTO `ankowhm`.`system_settings` (`Property`, `Category`, `Value`, `Type`, `DateCreated`, `DateUpdated`) VALUES ('groupSizeInventory', 'task', '100', 'Days', '2020-05-27 22:19:01', '2020-05-27 22:19:01');
INSERT INTO `ankowhm`.`system_settings` (`Property`, `Category`, `Value`, `DateCreated`, `DateUpdated`) VALUES ('groupSizeOnline', 'task', '4', '2020-05-27 22:19:01', '2020-05-27 22:19:01');
INSERT INTO `ankowhm`.`system_settings` (`Property`, `Category`, `Value`, `Type`, `DateCreated`, `DateUpdated`) VALUES ('groupSizePick', 'task', '100', 'Text', '2020-05-27 22:19:01', '2020-05-27 22:19:01');
INSERT INTO `ankowhm`.`system_settings` (`Property`, `Category`, `Value`, `Type`, `PreviousValue`, `DateCreated`, `DateUpdated`) VALUES ('groupSizeThreshold', 'task', '5', 'Number', '4', '2020-05-27 22:19:01', '2020-05-28 21:06:24');
INSERT INTO `ankowhm`.`system_settings` (`Property`, `Category`, `Value`, `DateCreated`, `DateUpdated`) VALUES ('maxLocationPerCase', 'receiveToStow', '10', '2020-05-27 22:19:01', '2020-05-27 22:19:01');
INSERT INTO `ankowhm`.`system_settings` (`Property`, `Category`, `Value`, `DateCreated`, `DateUpdated`) VALUES ('maxLocationPerSKU', 'receiveToStow', '10', '2020-05-27 22:19:01', '2020-05-27 22:19:01');
INSERT INTO `ankowhm`.`system_settings` (`Property`, `Category`, `Value`, `Type`, `DateCreated`, `DateUpdated`) VALUES ('maxQtyOverride', 'validation', '500', 'Minutes', '2020-05-27 22:19:01', '2020-05-27 22:19:01');
INSERT INTO `ankowhm`.`system_settings` (`Property`, `Category`, `Value`, `Type`, `PreviousValue`, `DateCreated`, `DateUpdated`) VALUES ('maxQtyOverrideList', 'validation', '42709664', 'Array', '42709664,dlsajflas', '2020-05-27 22:19:01', '2020-05-28 21:06:12');
INSERT INTO `ankowhm`.`system_settings` (`Property`, `Category`, `Value`, `Type`, `PreviousValue`, `DateCreated`, `DateUpdated`) VALUES ('maxQuantity', 'validation', 'false', 'Boolean', '350', '2020-05-27 22:19:01', '2020-05-28 21:17:28');
INSERT INTO `ankowhm`.`system_settings` (`Property`, `Category`, `Value`, `DateCreated`, `DateUpdated`) VALUES ('maxUniqueBarcodes', 'inventoryChecks', '45', '2020-05-27 22:19:01', '2020-05-27 22:19:01');
INSERT INTO `ankowhm`.`system_settings` (`Property`, `Category`, `Value`, `DateCreated`, `DateUpdated`) VALUES ('offsetCasePick', 'dueDate', '4', '2020-05-27 22:19:01', '2020-05-27 22:19:01');
INSERT INTO `ankowhm`.`system_settings` (`Property`, `Category`, `Value`, `DateCreated`, `DateUpdated`) VALUES ('offsetDefault', 'dueDate', '4', '2020-05-27 22:19:01', '2020-05-27 22:19:01');
INSERT INTO `ankowhm`.`system_settings` (`Property`, `Category`, `Value`, `DateCreated`, `DateUpdated`) VALUES ('offsetInventory', 'dueDate', '4', '2020-05-27 22:19:01', '2020-05-27 22:19:01');
INSERT INTO `ankowhm`.`system_settings` (`Property`, `Category`, `Value`, `DateCreated`, `DateUpdated`) VALUES ('offsetOnlineISP', 'dueDate', '0.8', '2020-05-27 22:19:01', '2020-05-27 22:19:01');
INSERT INTO `ankowhm`.`system_settings` (`Property`, `Category`, `Value`, `DateCreated`, `DateUpdated`) VALUES ('offsetOnlineShip', 'dueDate', '1.9', '2020-05-27 22:19:01', '2020-05-27 22:19:01');
INSERT INTO `ankowhm`.`system_settings` (`Property`, `Category`, `Value`, `DateCreated`, `DateUpdated`) VALUES ('offsetPickFasttrack', 'dueDate', '0.8', '2020-05-27 22:19:01', '2020-05-27 22:19:01');
INSERT INTO `ankowhm`.`system_settings` (`Property`, `Category`, `Value`, `DateCreated`, `DateUpdated`) VALUES ('offsetPickStandard', 'dueDate', '1.1', '2020-05-27 22:19:01', '2020-05-27 22:19:01');
INSERT INTO `ankowhm`.`system_settings` (`Property`, `Category`, `Value`, `DateCreated`, `DateUpdated`) VALUES ('WarehouseOrderDays', 'PDU', '1', '2020-05-27 22:19:01', '2020-05-27 22:19:01');
INSERT INTO `ankowhm`.`system_settings` (`Property`, `Category`, `Value`, `Type`, `DateCreated`, `DateUpdated`) VALUES ('minVarianceExternalAndRFID', 'RFID', '1', 'Number', '2020-05-27 22:19:01', '2020-05-27 22:19:01');

INSERT INTO product_department(ID, Name) VALUES
  ("001","WMS FOOTWEAR"),
  ("002","WMS SEASONAL"),
  ("004","WMS KNIT TOPS"),
  ("005","WMS BOTTOMS"),
  ("006","GIRLSWEAR 1-8"),
  ("007","WMS MATERNITY"),
  ("008","GIRLSWEAR 7-16"),
  ("009","MENS FOOTWEAR"),
  ("010","WMS SLEEPWEAR"),
  ("011","WMS BRIEFS/FUNCTIO"),
  ("012","WMS BRAS/CO-ORDS"),
  ("013","WMS HOSIERY/SOCKS"),
  ("015","LAUNDRY & STORAGE"),
  ("016","BOYSWEAR 7-16"),
  ("017","XMAS TRIM & WRAP"),
  ("019","SCHOOLWEAR APPAREL"),
  ("020","COSMETICS"),
  ("021","SEASONAL FOOD"),
  ("022","KIDS INDOOR PLAY"),
  ("023","BOOKS"),
  ("024","STATIONERY & CRAFT"),
  ("025","CARDS & WRAP"),
  ("026","BOYSWEAR 1-8"),
  ("028","PARTY GOODS"),
  ("029","EASTER"),
  ("030","BABYWEAR"),
  ("032","JWLRY/WATCH/SGLASS"),
  ("033","NURSERY"),
  ("034","KIDS U/WEAR SOCKS"),
  ("036","HANDBAGS & ACC"),
  ("037","MENS ACCESSORIES"),
  ("038","KITCHEN"),
  ("040","DINING"),
  ("041","WHOLESALE GM"),
  ("042","WHOLESALE APP"),
  ("044","CONFECTIONERY"),
  ("045","GROCERY FOOD"),
  ("046","PET CARE"),
  ("047","ACTION/VEHICLE TOY"),
  ("048","BACKPACKS & TRAVEL"),
  ("049","GARDEN GREENS"),
  ("050","MOBILE PHONES"),
  ("052","WMS WVN TOPS/DRESS"),
  ("053","PHOTO CENTRE"),
  ("054","FURNITURE"),
  ("055","ACTIVE FOOTWEAR"),
  ("056","APPLIANCES"),
  ("057","KIDS ACCESSORIES"),
  ("060","WMS LEISURE"),
  ("064","ACTIVE MENSWEAR"),
  ("065","ACTIVE WOMENSWEAR"),
  ("066","HOME FURNISHINGS"),
  ("067","DOLLS/CONSTRUCTION"),
  ("068","MAGAZINES"),
  ("069","HOME & AUTO CARE"),
  ("070","WMS CURVE"),
  ("071","HOME DECORATOR"),
  ("072","BATHROOM"),
  ("073","BEDROOM ACC"),
  ("074","BED LINEN"),
  ("075","FAMILY TECHNOLOGY"),
  ("076","CAMPING"),
  ("077","RECREATION & BIKES"),
  ("078","FISHING"),
  ("079","KIDS HOME"),
  ("080","DVD & MUSIC"),
  ("081","CHILDRENS FOOTWEAR"),
  ("084","ACTIVE KIDSWEAR"),
  ("085","PERSONAL CARE"),
  ("087","PRESCHOOL TOYS"),
  ("088","KIDS SLEEPWEAR"),
  ("090","MENS U/WEAR/SOCKS"),
  ("091","MENS T/S & TOPS"),
  ("092","MENS BOTTOMS"),
  ("093","MENS SLEEPWEAR"),
  ("096","MENS WORK DEPT"),
  ("097","REUSABLE BAGS"),
  ("098","NEVER TO BE USED"),
  ("099","GIFT CARDS & RCHRG");

INSERT INTO product_code(ProductCode, Description, Priority) VALUES
  (0, 'Replenishment line with ongoing orders', 1),
  (3, 'Quit line with dead keycodes', 2),
  (4, 'Seasonal line with limited stock drops', 2),
  (6, 'New line that will go onto Replenishment', 2),
  (8, 'Clearance line with no future stock drops', 2);
