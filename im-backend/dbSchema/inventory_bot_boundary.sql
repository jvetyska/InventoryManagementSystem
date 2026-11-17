CREATE TABLE `inventory_bot_boundary` (
  `ID` int NOT NULL AUTO_INCREMENT,
  `Name` varchar(45) NOT NULL,
  `Map` varchar(45) NOT NULL,
  `ContainerID` varchar(13) DEFAULT NULL,
  `Area` varchar(45) DEFAULT NULL,
  `LocationID` varchar(13) NOT NULL,
  `Point1X` float NOT NULL,
  `Point2X` float NOT NULL,
  `Point1Y` float NOT NULL,
  `Point2Y` float NOT NULL,
  `MapLeft` int NOT NULL,
  `MapTop` int NOT NULL,
  `MapHeight` int NOT NULL,
  `MapWidth` int NOT NULL,
  PRIMARY KEY (`ID`),
  KEY `fk_boundary_container_idx` (`ContainerID`),
  CONSTRAINT `fk_boundary_container` FOREIGN KEY (`ContainerID`) REFERENCES `container` (`ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
