-- ================================================================
-- CC Manager - Test Data Import Script
-- Generated for testing purposes
-- ================================================================

-- Disable foreign key checks temporarily
PRAGMA foreign_keys = OFF;

-- ================================================================
-- 1. SHOPS - First, create shops (referenced by orders)
-- ================================================================

INSERT OR IGNORE INTO shops (name, domain, created_at) VALUES
('Rotunda Tech Tools', 'rotundatechtools.com', datetime('now')),
('Furnace Part Source', 'furnacepartsource.com', datetime('now')),
('RS Online', 'us.rs-online.com', datetime('now')),
('Breaker Outlet', 'breakeroutlet.com', datetime('now')),
('North America HVAC', 'northamericahvac.com', datetime('now')),
('Crescent Electric', 'crescentelectric.com', datetime('now')),
('Live Wire Supply', 'livewiresupply.com', datetime('now')),
('K Tool International', 'ktool.net', datetime('now')),
('Tool Discounter', 'tooldiscounter.com', datetime('now')),
('EZ Test Pools', 'eztestpools.com', datetime('now')),
('Abes of Maine', 'abesofmaine.com', datetime('now')),
('HVAC Wholesale Direct', 'hvacwholesaledirect.com', datetime('now')),
('Brand New Tools', 'brandnewtools.com', datetime('now')),
('Pool Supply Express', 'poolsupplyexpress.com', datetime('now')),
('Dale Electric', 'dale-electric.com', datetime('now')),
('Circuit Breaker Warehouse', 'circuitbreakerwarehouse.com', datetime('now')),
('SP Industrial', 'spwindustrial.com', datetime('now')),
('Super Breakers', 'superbreakers.com', datetime('now')),
('Sylvane', 'sylvane.com', datetime('now')),
('Wholesale Pool Equipment', 'wholesalepoolequipment.com', datetime('now')),
('Value Controls', 'value-controls.com', datetime('now')),
('Autoplicity', 'autoplicity.com', datetime('now')),
('Right To Bear Arms', 'righttobeararmsnm.com', datetime('now')),
('Arb Session', 'arbsession.com', datetime('now')),
('Murdochs Ranch', 'murdochs.com', datetime('now')),
('Ballard Industrial', 'ballardindustrial.com', datetime('now')),
('Construction Tool Warehouse', 'constructiontoolwarehouse.com', datetime('now')),
('Gross Electric', 'grosselectric.com', datetime('now')),
('CP Power Tools', 'cpowertools.com', datetime('now')),
('Ham Radio Outlet', 'hamradio.com', datetime('now')),
('Woodworking Shop', 'woodworkingshop.com', datetime('now')),
('Tru Door', 'trudoor.com', datetime('now')),
('Just Say Golf', 'justsaygolf.com', datetime('now')),
('Capp USA', 'cappusa.com', datetime('now'));

-- ================================================================
-- 2. CREDIT CARDS - Create all cards from TG1-TG43
-- ================================================================

INSERT INTO credit_cards
(bin, last4, expiry_date, holder_name, billing_address, city, state, zip, country, phone, email,
 card_type, card_level, status, source, notes, created_at)
VALUES
-- TG1 | PA
('662421', '6189', '11/2030', 'Jenna Shock', '247 Shadowlawn Ave', 'Pittsburgh', 'PA', '15216', 'USA', '7706249097', 'jones_jackie2000@aol.com',
 'visa', 'classic', 'free', 'TG1 Import', 'IP: 66.242.156.189 | 1418 Superior Ave, Wilkinsburg, PA 15221', datetime('now')),

('414720', '3736', '11/2030', 'Jenna Shock', '1100 E WYOMISSING BLVD APT 27B', 'READING', 'PA', '19611', 'USA', '7706249097', 'jones_jackie2000@aol.com',
 'visa', 'classic', 'free', 'TG1 Import', 'Secondary address', datetime('now')),

-- TG2 | FL
('414720', '9158', '07/2029', 'Christie Leonard', '1177 Venetian Harbor Dr NE', 'St Petersburg', 'FL', '33702', 'USA', '6318077286', 'christine.nash629644@yahoo.com',
 'visa', 'classic', 'free', 'TG2 Import', 'IP: 97.106.121.77 | 5821 Calais Ln, Saint Petersburg, FL 33714', datetime('now')),

-- TG3 | TX
('341250', '1004', '02/2030', 'Daniel D Smallwood', '1200 Thurman Bluff Drive', 'Spicewood', 'TX', '78669', 'USA', '4355316385', 'danielle_vinson1996@yahoo.com',
 'amex', 'gold', 'free', 'TG3 Import', 'IP: 70.121.170.230 | 2904 Impala Dr, Brownsville, TX 78521', datetime('now')),

-- TG4 | WA
('371753', '2007', '10/2027', 'LAURIE WYATT', 'PO Box 129', 'Montesano', 'WA', '98563', 'USA', '7403500697', 'lanninchris3547@aol.com',
 'amex', 'gold', 'free', 'TG4 Import', 'IP: 173.209.162.109 | 1325 4Th Ave E, Olympia, WA 98506', datetime('now')),

-- TG5 | IL
('520943', '2462', '12/2027', 'Kim Perry', '8712 Rosewood Hills', 'Edwardsville', 'IL', '62025', 'USA', '9709427501', 'king_cole951955@aol.com',
 'mastercard', 'world', 'free', 'TG5 Import', 'IP: 73.22.28.177 | 1375 Vandalia St Apt 33, Collinsville, IL 62234', datetime('now')),

-- TG6 | FL
('406095', '0289', '08/2027', 'Ian Brody', '1997 Avila Way', 'Middleburg', 'FL', '32068', 'USA', '2037484548', 'liu_david701293@aol.com',
 'visa', 'classic', 'free', 'TG6 Import', 'IP: 142.196.161.174 | 13468 Ashford Wood Ct W, Jacksonville, FL 32218', datetime('now')),

-- TG7 | NY
('414720', '6354', '08/2030', 'Erica Fish', '3 Vermont Ave', 'White Plains', 'NY', '10606', 'USA', '3072537516', 'fish.rob2001@aol.com',
 'visa', 'classic', 'free', 'TG7 Import', 'IP: 142.255.52.13 | 2111 Lafontaine Ave Apt 8L, Bronx, NY 10457', datetime('now')),

-- TG8 | FL
('438857', '6062', '03/2030', 'angela repel', '1145 Gulf of Mexico Dr', 'Longboat Key', 'FL', '34228', 'USA', '2057372713', 'randylarson5369@aol.com',
 'visa', 'signature', 'free', 'TG8 Import', 'IP: 97.106.121.77 | 860 34TH AVE S APT 27, SAINT PETERSBURG, FL 33705', datetime('now')),

-- TG9 | NC
('414720', '4551', '05/2029', 'Allison Blankenship', '1309 Huntwood Ln', 'Cary', 'NC', '27511', 'USA', '3072537516', 'agelirujay34@gmail.com',
 'visa', 'classic', 'free', 'TG9 Import', 'IP: 75.177.167.230 | 3133 Calumet Dr H, Raleigh, NC 27610', datetime('now')),

-- TG10 | NY
('423232', '2728', '08/2029', 'Kellie E Brown', '45 hickory st', 'Rochester', 'NY', '14620', 'USA', '7135189620', 'krug.cody2002@aol.com',
 'visa', 'classic', 'free', 'TG10 Import', 'IP: 66.66.129.27 | 337 Lisbon Ave, Buffalo, NY 14215', datetime('now')),

-- TG11 | FL
('379132', '5000', '01/2030', 'Lissany Orellana Kelly', '1705 E Horatio Ave', 'Maitland', 'FL', '32751', 'USA', '9033935675', 'lanninchris3547@aol.com',
 'amex', 'gold', 'free', 'TG11 Import', 'IP: 97.68.7.138 | 321 Sabal Park Pl Apt 207, Longwood, FL 32779', datetime('now')),

-- TG12 | FL
('417903', '5795', '06/2027', 'Jonathan Lizotte', '4364 N Oceanshore Blvd', 'Palm coast', 'FL', '32137', 'USA', '7135189631', 'jones_jackie2000@aol.com',
 'visa', 'classic', 'free', 'TG12 Import', 'IP: 66.177.197.26 | 4180 Nw 50Th Ter Apt 6107, Gainesville, FL 32607', datetime('now')),

-- TG13 | OH
('431196', '9557', '05/2027', 'Jill R Claire', '9674 Colerain Ave', 'Cincinnati', 'OH', '45251', 'USA', '5128885650', 'julie_freed4241@yahoo.com',
 'visa', 'classic', 'free', 'TG13 Import', 'IP: 74.134.21.158 | 1790 Grand Ave Apt 4, Cincinnati, OH 45214', datetime('now')),

-- TG14 | FL
('409970', '4787', '09/2027', 'Mark Little', '7033 Yellow Bluff Road', 'Panama City', 'FL', '32404', 'USA', '5123670813', 'melody.greer1986@aol.com',
 'visa', 'classic', 'free', 'TG14 Import', 'IP: 72.17.54.230 | 507 N Gray Ave, Panama City, FL 32401', datetime('now')),

-- TG15 | NV
('414718', '6014', '01/2029', 'Richard Chambers', 'PO Box 2049', 'Stateline', 'NV', '89449', 'USA', '5128484030', 'ryanskerving1985@yahoo.com',
 'visa', 'classic', 'free', 'TG15 Import', 'IP: 74.82.159.40 | 745 Gullwing Ln, North Las Vegas, NV 89081', datetime('now')),

-- TG16 | NV
('438984', '3374', '03/2028', 'Tiffany Norris', '228 Bailey Rd', 'Curwensville', 'PA', '16823', 'USA', '7135189662', 'smithvzmtmy@aol.com',
 'visa', 'classic', 'free', 'TG16 Import', 'IP: 98.114.238.171 | 4019 Francis St, Temple, PA 19560', datetime('now')),

-- TG17 | MI
('542418', '5877', '05/2029', 'Gregory Long', '710 Brenneman St', 'Potterville', 'MI', '48876', 'USA', '3466669524', 'gregjean472481@yahoo.com',
 'mastercard', 'world', 'free', 'TG17 Import', 'IP: 68.51.255.238 | 8880 N Hartel Rd, Grand Ledge, MI 48837', datetime('now')),

-- TG18 | IL
('601100', '4627', '06/2026', 'Kimberly Rosch', '6816 Pelham Manor Dr', 'Fairview Heights', 'IL', '62208', 'USA', '9202173479', 'larry.schlag687625@yahoo.com',
 'discover', 'classic', 'free', 'TG18 Import', 'IP: 96.70.61.130 | 2247E Cedar Street, Springfield, IL 62703', datetime('now')),

-- TG19 | NJ
('371211', '2007', '08/2030', 'Sylvia Hanna', '14 William Way', 'Long Valley', 'NJ', '07853', 'USA', '4083931473', 'surabhijonnie424561@aol.com',
 'amex', 'gold', 'free', 'TG19 Import', 'IP: 68.197.58.151 | 32 Sager Pl, Hillside, NJ 07205', datetime('now')),

-- TG20 | CA
('518941', '3736', '12/2029', 'Todd Miller', '721 Poppy Ave', 'Corona Del Mar', 'CA', '92625', 'USA', '8594090950', 'tariqdiggs1989@yahoo.com',
 'mastercard', 'world', 'free', 'TG20 Import', 'IP: 76.169.114.123 | 444 N Amelia Ave Apt 17G, San Dimas, CA 91773', datetime('now')),

-- TG21 | VA
('406095', '1572', '10/2026', 'Jennifer Dryer', '1704 Colson Court', 'Virginia Beach', 'VA', '23454', 'USA', '7133966112', 'jenniferbell8623@yahoo.com',
 'visa', 'classic', 'free', 'TG21 Import', 'IP: 24.101.87.146 | 1587 BRIARFIELD RD APT 28, HAMPTON, VA 23666', datetime('now')),

-- TG22 | MD
('517908', '8193', '01/2030', 'Padraic', '149 Pinnacle Court', 'Warrenton', 'VA', '20186', 'USA', '2404440423', 'darnellshane564671@yahoo.com',
 'mastercard', 'world', 'free', 'TG22 Import', 'IP: 138.88.134.228 | 5016 Denmore Ave, Baltimore, MD 21215', datetime('now')),

-- TG23 | NC
('379301', '3007', '12/2030', 'David Broad', '102 Preston Grande Way', 'Morrisville', 'NC', '27560', 'USA', '2694706063', 'darrellpippinmd3736@aol.com',
 'amex', 'gold', 'free', 'TG23 Import', 'IP: 173.219.103.9 | 111 Inglewood Dr, Louisburg, NC 27549', datetime('now')),

-- TG24 | AR
('426690', '8764', '08/2026', 'Jana Morris', '439 Roy Rd', 'Nashville', 'AR', '71852', 'USA', '2084063632', 'jerron.starr1981@aol.com',
 'visa', 'classic', 'free', 'TG24 Import', 'IP: 173.174.229.227 | 206 Oakhurst Blvd Apt 227 Bldg 1, El Dorado, AR 71730', datetime('now')),

-- TG25 | WA
('414734', '3972', '02/2028', 'Erica Lyn Langdon', '1221 1st Ave Apt 1003', 'Seattle', 'WA', '98101', 'USA', '3174102842', 'earl.lesperance867102@aol.com',
 'visa', 'classic', 'free', 'TG25 Import', 'IP: 173.209.162.109 | 19230 46TH AVE S, SEATAC, WA 98188', datetime('now')),

-- TG26 | CA
('414720', '9796', '02/2028', 'JENNIFER KLINE', '1241 CEDAR OAK', 'Placerville', 'CA', '95667', 'USA', '4352793446', 'jennifer.nickerson8674@aol.com',
 'visa', 'classic', 'free', 'TG26 Import', 'IP: 73.15.233.84 | 829 FULTON AVE APT 1060, SACRAMENTO, CA 95825', datetime('now')),

-- TG27 | CT
('438854', '6161', '07/2028', 'Janice Cannon', '489a Heritage Village', 'Southbury', 'CT', '06488', 'USA', '7036099277', 'leqobigalic587@gmail.com',
 'visa', 'signature', 'free', 'TG27 Import', 'IP: 72.209.14.145 | 734 Orchard Street Apt#2, New Haven, CT 06511', datetime('now')),

-- TG28 | NE
('409451', '4922', '03/2028', 'Matt Swinton', '1101 Jackson St #203', 'Omaha', 'NE', '68102', 'USA', '6198892757', 'moorecrystal185615@yahoo.com',
 'visa', 'classic', 'free', 'TG28 Import', 'IP: 74.95.220.249 | 3905 Ida St, Omaha, NE 68112', datetime('now')),

-- TG29 | PA
('442779', '2426', '03/2027', 'Wade Schaeffer', '218 East Penn Avenue', 'Cleona', 'PA', '17042', 'USA', '2088510438', 'wilcoxsarah490751@yahoo.com',
 'visa', 'classic', 'free', 'TG29 Import', 'IP: 146.115.254.197 | 1103 W Somerville Ave, Philadelphia, PA 19141', datetime('now')),

-- TG30 | RI
('552486', '2334', '04/2028', 'Tracy Glover', '120 Bluff Ave', 'Cranston', 'RI', '02905', 'USA', '2084063634', 'tricia_ahmed15229@yahoo.com',
 'mastercard', 'world', 'free', 'TG30 Import', 'IP: 98.182.41.247 | 107 Mill St, Randolph MA, 02368', datetime('now')),

-- TG31 | NC
('414720', '2403', '07/2027', 'Heather hastings', '500 Hogans Valley Way', 'Cary', 'NC', '27513', 'USA', '6057233352', 'hassan.nicole1991@aol.com',
 'visa', 'classic', 'free', 'TG31 Import', 'IP: 75.177.167.230 | 1814 Fountain Dr # 1814, Raleigh, NC 27610', datetime('now')),

-- TG32 | WA
('341169', '1000', '04/2029', 'Jennifer Pitts', '6621 Charlotte Ave SE', 'Auburn', 'WA', '98092', 'USA', '6104059229', 'tracynixon253778@yahoo.com',
 'amex', 'gold', 'free', 'TG32 Import', 'IP: 173.209.162.109 | 1228 69Th Ave E, Fife, WA 98424', datetime('now')),

-- TG33 | VA
('377246', '9001', '04/2030', 'Karin Ferguson', '1641 Westhall Gardens Drive', 'N Chesterfield', 'VA', '23235', 'USA', '5107983123', 'kearney_monique7656@aol.com',
 'amex', 'gold', 'free', 'TG33 Import', 'IP: 72.83.153.33 | 17 BARNES CT | HAMPTON | 23664 | VA', datetime('now')),

-- TG34 | IL
('414709', '1804', '10/2029', 'Lori Jelinek', '2412 Sedwick Dr', 'Normal', 'IL', '61761', 'USA', '6173081472', 'moorecrystal185615@yahoo.com',
 'visa', 'classic', 'free', 'TG34 Import', 'IP: 72.26.187.247 | 678 WILLOW POND RD | RANTOUL | 61866 | IL', datetime('now')),

-- TG35 | TN
('601101', '7826', '04/2027', 'Martin Reed Moncier', '5311 Windingbrooke Lane', 'Knoxville', 'TN', '37918', 'USA', '8056358444', 'foxbrian1434@aol.com',
 'discover', 'classic', 'free', 'TG35 Import', 'IP: 107.197.232.237 | 3208 EASTERLAND ST | KNOXVILLE | 37917 | TN', datetime('now')),

-- TG36 | TX
('414720', '0119', '11/2029', 'Jacqueline Phillips', '13807 Sea Horse Ave', 'CORPUS CHRISTI', 'TX', '78418', 'USA', '9084199049', 'joseph_tobin574965@aol.com',
 'visa', 'classic', 'free', 'TG36 Import', 'IP: 216.228.71.178 | 550 W 22ND ST APT 10307 | GEORGETOWN | 78626 | TX', datetime('now')),

-- TG37 | MS
('407887', '5351', '05/2028', 'Dominic Mickelson', '2423 South Theodore Avenue', 'Sioux Falls', 'SD', '57106', 'USA', '2128449883', 'denismurray1985@aol.com',
 'visa', 'classic', 'free', 'TG37 Import', 'IP: 69.54.112.98 | 121 COLUMBIA AVE | JACKSON | 39209 | MS', datetime('now')),

-- TG38 | CO
('601101', '0498', '01/2028', 'Susan Rainsberry', '439 Agency Drive', 'MEEKER', 'CO', '81641', 'USA', '4142545273', 'vogtkarla5711@yahoo.com',
 'discover', 'classic', 'free', 'TG38 Import', 'IP: 69.170.193.152 | 420 PACIFIC AVE | FORT LUPTON | 80621 | CO', datetime('now')),

-- TG39 | NH
('414740', '4080', '12/2027', 'Joanie A Samuelson', '57 Sunset Rd', 'East Wakefield', 'NH', '03830', 'USA', '5205590921', 'graf_jose1982@aol.com',
 'visa', 'classic', 'free', 'TG39 Import', 'IP: 66.31.200.235 | 31 FORTIN DR | BROCKTON | 02302 | MA', datetime('now')),

-- TG40 | MD
('555376', '5096', '05/2027', 'David W Donovan', '415 Gun Road', 'Halethorpe', 'MD', '21227', 'USA', '21070537362', 'zuromski.kara1994@aol.com',
 'mastercard', 'world', 'free', 'TG40 Import', 'IP: 69.243.88.194 | 8612 MONMOUTH DR | UPPER MARLBORO | 20772 | MD', datetime('now')),

-- TG41 | PA
('414718', '8912', '01/2030', 'Nancy A Gregg', '130 Beechtree Dr', 'Broomall', 'PA', '19008', 'USA', '9703661312', 'ruby.washington2001@aol.com',
 'visa', 'classic', 'free', 'TG41 Import', 'IP: 146.115.254.197 | 2058 MAPLE AVE APT AH1-10 | HATFIELD | 19440 | PA', datetime('now')),

-- TG42 | PA
('371381', '9006', '09/2028', 'charles h campbell', '105 rossmore drive', 'malvern', 'PA', '19355', 'USA', '7179892652', 'gravesquitta74837@yahoo.com',
 'amex', 'gold', 'free', 'TG42 Import', 'IP: 173.49.190.88 | 208 Dock St Apt 214 | Schuylkill Haven | 17972 | PA', datetime('now')),

-- TG43 | FL
('414709', '0959', '04/2030', 'John Pohlmann', 'PO Box 203', 'Gulf Breeze', 'FL', '32562', 'USA', '3344679181', 'graf_jose1982@aol.com',
 'visa', 'classic', 'free', 'TG43 Import', 'IP: 70.167.235.177 | 314 W NINE ONE HALF MILE RD | PENSACOLA | 32534 | FL', datetime('now'));

-- ================================================================
-- 3. PROFILES - Create profiles linked to cards
-- ================================================================

-- Get card IDs and create profiles (will be done via script after import)
-- For now, create profiles without card linkage

INSERT INTO profiles (id, notes, created_at, updated_at) VALUES
('tg1-profile-pa', 'TG1 Pennsylvania Profile', datetime('now'), datetime('now')),
('tg2-profile-fl', 'TG2 Florida Profile', datetime('now'), datetime('now')),
('tg3-profile-tx', 'TG3 Texas Profile', datetime('now'), datetime('now')),
('tg4-profile-wa', 'TG4 Washington Profile', datetime('now'), datetime('now')),
('tg5-profile-il', 'TG5 Illinois Profile', datetime('now'), datetime('now')),
('tg6-profile-fl', 'TG6 Florida Profile 2', datetime('now'), datetime('now')),
('tg7-profile-ny', 'TG7 New York Profile', datetime('now'), datetime('now')),
('tg8-profile-fl', 'TG8 Florida Profile 3', datetime('now'), datetime('now')),
('tg9-profile-nc', 'TG9 North Carolina Profile', datetime('now'), datetime('now')),
('tg10-profile-ny', 'TG10 New York Profile 2', datetime('now'), datetime('now'));

-- ================================================================
-- 4. ORDERS - Create sample orders with tracking
-- ================================================================

-- Orders will be added after profiles are linked to cards
-- This requires getting the actual card/profile IDs after import

-- ================================================================
-- Re-enable foreign key checks
PRAGMA foreign_keys = ON;

-- ================================================================
-- Summary
-- ================================================================
-- This script imports:
-- - 34 Shops
-- - 43 Credit Cards (TG1-TG43)
-- - 10 Profiles (sample)
--
-- After import, run the application and:
-- 1. Link profiles to cards via UI
-- 2. Create orders manually or via IMAP
-- 3. Test Smart Automation features
-- ================================================================
