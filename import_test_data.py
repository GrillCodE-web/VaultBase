#!/usr/bin/env python3
"""
VaultBase - Test Data Import Script
Imports TG1-TG43 data with proper relationships
"""

import sqlite3
import json
from datetime import datetime

DB_PATH = 'vaultbase.db'

# ============================================================================
# DATA DEFINITIONS
# ============================================================================

SHOPS = [
    ('Rotunda Tech Tools', 'rotundatechtools.com'),
    ('Furnace Part Source', 'furnacepartsource.com'),
    ('RS Online', 'us.rs-online.com'),
    ('Breaker Outlet', 'breakeroutlet.com'),
    ('North America HVAC', 'northamericahvac.com'),
    ('Crescent Electric', 'crescentelectric.com'),
    ('Live Wire Supply', 'livewiresupply.com'),
    ('K Tool International', 'ktool.net'),
    ('Tool Discounter', 'tooldiscounter.com'),
    ('EZ Test Pools', 'eztestpools.com'),
    ('Abes of Maine', 'abesofmaine.com'),
    ('HVAC Wholesale Direct', 'hvacwholesaledirect.com'),
    ('Brand New Tools', 'brandnewtools.com'),
    ('Pool Supply Express', 'poolsupplyexpress.com'),
    ('Dale Electric', 'dale-electric.com'),
    ('Circuit Breaker Warehouse', 'circuitbreakerwarehouse.com'),
    ('SP Industrial', 'spwindustrial.com'),
    ('Super Breakers', 'superbreakers.com'),
    ('Sylvane', 'sylvane.com'),
    ('Wholesale Pool Equipment', 'wholesalepoolequipment.com'),
    ('Value Controls', 'value-controls.com'),
    ('Autoplicity', 'autoplicity.com'),
    ('Right To Bear Arms', 'righttobeararmsnm.com'),
    ('Arb Session', 'arbsession.com'),
    ('Murdochs Ranch', 'murdochs.com'),
    ('Ballard Industrial', 'ballardindustrial.com'),
    ('Construction Tool Warehouse', 'constructiontoolwarehouse.com'),
    ('Gross Electric', 'grosselectric.com'),
    ('CP Power Tools', 'cpowertools.com'),
    ('Ham Radio Outlet', 'hamradio.com'),
    ('Woodworking Shop', 'woodworkingshop.com'),
    ('Tru Door', 'trudoor.com'),
    ('Just Say Golf', 'justsaygolf.com'),
    ('Capp USA', 'cappusa.com'),
]

CARDS = [
    # TG1 | PA
    {'tg': 'TG1', 'bin': '662421', 'last4': '6189', 'expiry': '11/2030', 'holder': 'Jenna Shock',
     'address': '247 Shadowlawn Ave', 'city': 'Pittsburgh', 'state': 'PA', 'zip': '15216',
     'country': 'USA', 'phone': '7706249097', 'email': 'jones_jackie2000@aol.com',
     'type': 'visa', 'level': 'classic', 'ip': '66.242.156.189',
     'notes': 'IP: 66.242.156.189 | 1418 Superior Ave, Wilkinsburg, PA 15221'},

    {'tg': 'TG1', 'bin': '414720', 'last4': '3736', 'expiry': '11/2030', 'holder': 'Jenna Shock',
     'address': '1100 E WYOMISSING BLVD APT 27B', 'city': 'READING', 'state': 'PA', 'zip': '19611',
     'country': 'USA', 'phone': '7706249097', 'email': 'jones_jackie2000@aol.com',
     'type': 'visa', 'level': 'classic', 'ip': '66.242.156.189',
     'notes': 'Secondary address'},

    # TG2 | FL
    {'tg': 'TG2', 'bin': '414720', 'last4': '9158', 'expiry': '07/2029', 'holder': 'Christie Leonard',
     'address': '1177 Venetian Harbor Dr NE', 'city': 'St Petersburg', 'state': 'FL', 'zip': '33702',
     'country': 'USA', 'phone': '6318077286', 'email': 'christine.nash629644@yahoo.com',
     'type': 'visa', 'level': 'classic', 'ip': '97.106.121.77',
     'notes': 'IP: 97.106.121.77 | 5821 Calais Ln, Saint Petersburg, FL 33714'},

    # TG3 | TX
    {'tg': 'TG3', 'bin': '341250', 'last4': '1004', 'expiry': '02/2030', 'holder': 'Daniel D Smallwood',
     'address': '1200 Thurman Bluff Drive', 'city': 'Spicewood', 'state': 'TX', 'zip': '78669',
     'country': 'USA', 'phone': '4355316385', 'email': 'danielle_vinson1996@yahoo.com',
     'type': 'amex', 'level': 'gold', 'ip': '70.121.170.230',
     'notes': 'IP: 70.121.170.230 | 2904 Impala Dr, Brownsville, TX 78521'},

    # TG4 | WA
    {'tg': 'TG4', 'bin': '371753', 'last4': '2007', 'expiry': '10/2027', 'holder': 'LAURIE WYATT',
     'address': 'PO Box 129', 'city': 'Montesano', 'state': 'WA', 'zip': '98563',
     'country': 'USA', 'phone': '7403500697', 'email': 'lanninchris3547@aol.com',
     'type': 'amex', 'level': 'gold', 'ip': '173.209.162.109',
     'notes': 'IP: 173.209.162.109 | 1325 4Th Ave E, Olympia, WA 98506'},

    # TG5 | IL
    {'tg': 'TG5', 'bin': '520943', 'last4': '2462', 'expiry': '12/2027', 'holder': 'Kim Perry',
     'address': '8712 Rosewood Hills', 'city': 'Edwardsville', 'state': 'IL', 'zip': '62025',
     'country': 'USA', 'phone': '9709427501', 'email': 'king_cole951955@aol.com',
     'type': 'mastercard', 'level': 'world', 'ip': '73.22.28.177',
     'notes': 'IP: 73.22.28.177 | 1375 Vandalia St Apt 33, Collinsville, IL 62234'},

    # TG6 | FL
    {'tg': 'TG6', 'bin': '406095', 'last4': '0289', 'expiry': '08/2027', 'holder': 'Ian Brody',
     'address': '1997 Avila Way', 'city': 'Middleburg', 'state': 'FL', 'zip': '32068',
     'country': 'USA', 'phone': '2037484548', 'email': 'liu_david701293@aol.com',
     'type': 'visa', 'level': 'classic', 'ip': '142.196.161.174',
     'notes': 'IP: 142.196.161.174 | 13468 Ashford Wood Ct W, Jacksonville, FL 32218'},

    # TG7 | NY
    {'tg': 'TG7', 'bin': '414720', 'last4': '6354', 'expiry': '08/2030', 'holder': 'Erica Fish',
     'address': '3 Vermont Ave', 'city': 'White Plains', 'state': 'NY', 'zip': '10606',
     'country': 'USA', 'phone': '3072537516', 'email': 'fish.rob2001@aol.com',
     'type': 'visa', 'level': 'classic', 'ip': '142.255.52.13',
     'notes': 'IP: 142.255.52.13 | 2111 Lafontaine Ave Apt 8L, Bronx, NY 10457'},

    # TG8 | FL
    {'tg': 'TG8', 'bin': '438857', 'last4': '6062', 'expiry': '03/2030', 'holder': 'angela repel',
     'address': '1145 Gulf of Mexico Dr', 'city': 'Longboat Key', 'state': 'FL', 'zip': '34228',
     'country': 'USA', 'phone': '2057372713', 'email': 'randylarson5369@aol.com',
     'type': 'visa', 'level': 'signature', 'ip': '97.106.121.77',
     'notes': 'IP: 97.106.121.77 | 860 34TH AVE S APT 27, SAINT PETERSBURG, FL 33705'},

    # TG9 | NC
    {'tg': 'TG9', 'bin': '414720', 'last4': '4551', 'expiry': '05/2029', 'holder': 'Allison Blankenship',
     'address': '1309 Huntwood Ln', 'city': 'Cary', 'state': 'NC', 'zip': '27511',
     'country': 'USA', 'phone': '3072537516', 'email': 'agelirujay34@gmail.com',
     'type': 'visa', 'level': 'classic', 'ip': '75.177.167.230',
     'notes': 'IP: 75.177.167.230 | 3133 Calumet Dr H, Raleigh, NC 27610'},

    # TG10 | NY
    {'tg': 'TG10', 'bin': '423232', 'last4': '2728', 'expiry': '08/2029', 'holder': 'Kellie E Brown',
     'address': '45 hickory st', 'city': 'Rochester', 'state': 'NY', 'zip': '14620',
     'country': 'USA', 'phone': '7135189620', 'email': 'krug.cody2002@aol.com',
     'type': 'visa', 'level': 'classic', 'ip': '66.66.129.27',
     'notes': 'IP: 66.66.129.27 | 337 Lisbon Ave, Buffalo, NY 14215'},

    # TG11 | FL
    {'tg': 'TG11', 'bin': '379132', 'last4': '5000', 'expiry': '01/2030', 'holder': 'Lissany Orellana Kelly',
     'address': '1705 E Horatio Ave', 'city': 'Maitland', 'state': 'FL', 'zip': '32751',
     'country': 'USA', 'phone': '9033935675', 'email': 'lanninchris3547@aol.com',
     'type': 'amex', 'level': 'gold', 'ip': '97.68.7.138',
     'notes': 'IP: 97.68.7.138 | 321 Sabal Park Pl Apt 207, Longwood, FL 32779'},

    # TG12 | FL
    {'tg': 'TG12', 'bin': '417903', 'last4': '5795', 'expiry': '06/2027', 'holder': 'Jonathan Lizotte',
     'address': '4364 N Oceanshore Blvd', 'city': 'Palm coast', 'state': 'FL', 'zip': '32137',
     'country': 'USA', 'phone': '7135189631', 'email': 'jones_jackie2000@aol.com',
     'type': 'visa', 'level': 'classic', 'ip': '66.177.197.26',
     'notes': 'IP: 66.177.197.26 | 4180 Nw 50Th Ter Apt 6107, Gainesville, FL 32607'},

    # TG13 | OH
    {'tg': 'TG13', 'bin': '431196', 'last4': '9557', 'expiry': '05/2027', 'holder': 'Jill R Claire',
     'address': '9674 Colerain Ave', 'city': 'Cincinnati', 'state': 'OH', 'zip': '45251',
     'country': 'USA', 'phone': '5128885650', 'email': 'julie_freed4241@yahoo.com',
     'type': 'visa', 'level': 'classic', 'ip': '74.134.21.158',
     'notes': 'IP: 74.134.21.158 | 1790 Grand Ave Apt 4, Cincinnati, OH 45214'},

    # TG14 | FL
    {'tg': 'TG14', 'bin': '409970', 'last4': '4787', 'expiry': '09/2027', 'holder': 'Mark Little',
     'address': '7033 Yellow Bluff Road', 'city': 'Panama City', 'state': 'FL', 'zip': '32404',
     'country': 'USA', 'phone': '5123670813', 'email': 'melody.greer1986@aol.com',
     'type': 'visa', 'level': 'classic', 'ip': '72.17.54.230',
     'notes': 'IP: 72.17.54.230 | 507 N Gray Ave, Panama City, FL 32401'},

    # TG15 | NV
    {'tg': 'TG15', 'bin': '414718', 'last4': '6014', 'expiry': '01/2029', 'holder': 'Richard Chambers',
     'address': 'PO Box 2049', 'city': 'Stateline', 'state': 'NV', 'zip': '89449',
     'country': 'USA', 'phone': '5128484030', 'email': 'ryanskerving1985@yahoo.com',
     'type': 'visa', 'level': 'classic', 'ip': '74.82.159.40',
     'notes': 'IP: 74.82.159.40 | 745 Gullwing Ln, North Las Vegas, NV 89081'},

    # TG16 | NV
    {'tg': 'TG16', 'bin': '438984', 'last4': '3374', 'expiry': '03/2028', 'holder': 'Tiffany Norris',
     'address': '228 Bailey Rd', 'city': 'Curwensville', 'state': 'PA', 'zip': '16823',
     'country': 'USA', 'phone': '7135189662', 'email': 'smithvzmtmy@aol.com',
     'type': 'visa', 'level': 'classic', 'ip': '98.114.238.171',
     'notes': 'IP: 98.114.238.171 | 4019 Francis St, Temple, PA 19560'},

    # TG17 | MI
    {'tg': 'TG17', 'bin': '542418', 'last4': '5877', 'expiry': '05/2029', 'holder': 'Gregory Long',
     'address': '710 Brenneman St', 'city': 'Potterville', 'state': 'MI', 'zip': '48876',
     'country': 'USA', 'phone': '3466669524', 'email': 'gregjean472481@yahoo.com',
     'type': 'mastercard', 'level': 'world', 'ip': '68.51.255.238',
     'notes': 'IP: 68.51.255.238 | 8880 N Hartel Rd, Grand Ledge, MI 48837'},

    # TG18 | IL
    {'tg': 'TG18', 'bin': '601100', 'last4': '4627', 'expiry': '06/2026', 'holder': 'Kimberly Rosch',
     'address': '6816 Pelham Manor Dr', 'city': 'Fairview Heights', 'state': 'IL', 'zip': '62208',
     'country': 'USA', 'phone': '9202173479', 'email': 'larry.schlag687625@yahoo.com',
     'type': 'discover', 'level': 'classic', 'ip': '96.70.61.130',
     'notes': 'IP: 96.70.61.130 | 2247E Cedar Street, Springfield, IL 62703'},

    # TG19 | NJ
    {'tg': 'TG19', 'bin': '371211', 'last4': '2007', 'expiry': '08/2030', 'holder': 'Sylvia Hanna',
     'address': '14 William Way', 'city': 'Long Valley', 'state': 'NJ', 'zip': '07853',
     'country': 'USA', 'phone': '4083931473', 'email': 'surabhijonnie424561@aol.com',
     'type': 'amex', 'level': 'gold', 'ip': '68.197.58.151',
     'notes': 'IP: 68.197.58.151 | 32 Sager Pl, Hillside, NJ 07205'},

    # TG20 | CA
    {'tg': 'TG20', 'bin': '518941', 'last4': '3736', 'expiry': '12/2029', 'holder': 'Todd Miller',
     'address': '721 Poppy Ave', 'city': 'Corona Del Mar', 'state': 'CA', 'zip': '92625',
     'country': 'USA', 'phone': '8594090950', 'email': 'tariqdiggs1989@yahoo.com',
     'type': 'mastercard', 'level': 'world', 'ip': '76.169.114.123',
     'notes': 'IP: 76.169.114.123 | 444 N Amelia Ave Apt 17G, San Dimas, CA 91773'},

    # TG21 | VA
    {'tg': 'TG21', 'bin': '406095', 'last4': '1572', 'expiry': '10/2026', 'holder': 'Jennifer Dryer',
     'address': '1704 Colson Court', 'city': 'Virginia Beach', 'state': 'VA', 'zip': '23454',
     'country': 'USA', 'phone': '7133966112', 'email': 'jenniferbell8623@yahoo.com',
     'type': 'visa', 'level': 'classic', 'ip': '24.101.87.146',
     'notes': 'IP: 24.101.87.146 | 1587 BRIARFIELD RD APT 28, HAMPTON, VA 23666'},

    # TG22 | MD
    {'tg': 'TG22', 'bin': '517908', 'last4': '8193', 'expiry': '01/2030', 'holder': 'Padraic',
     'address': '149 Pinnacle Court', 'city': 'Warrenton', 'state': 'VA', 'zip': '20186',
     'country': 'USA', 'phone': '2404440423', 'email': 'darnellshane564671@yahoo.com',
     'type': 'mastercard', 'level': 'world', 'ip': '138.88.134.228',
     'notes': 'IP: 138.88.134.228 | 5016 Denmore Ave, Baltimore, MD 21215'},

    # TG23 | NC
    {'tg': 'TG23', 'bin': '379301', 'last4': '3007', 'expiry': '12/2030', 'holder': 'David Broad',
     'address': '102 Preston Grande Way', 'city': 'Morrisville', 'state': 'NC', 'zip': '27560',
     'country': 'USA', 'phone': '2694706063', 'email': 'darrellpippinmd3736@aol.com',
     'type': 'amex', 'level': 'gold', 'ip': '173.219.103.9',
     'notes': 'IP: 173.219.103.9 | 111 Inglewood Dr, Louisburg, NC 27549'},

    # TG24 | AR
    {'tg': 'TG24', 'bin': '426690', 'last4': '8764', 'expiry': '08/2026', 'holder': 'Jana Morris',
     'address': '439 Roy Rd', 'city': 'Nashville', 'state': 'AR', 'zip': '71852',
     'country': 'USA', 'phone': '2084063632', 'email': 'jerron.starr1981@aol.com',
     'type': 'visa', 'level': 'classic', 'ip': '173.174.229.227',
     'notes': 'IP: 173.174.229.227 | 206 Oakhurst Blvd Apt 227 Bldg 1, El Dorado, AR 71730'},

    # TG25 | WA
    {'tg': 'TG25', 'bin': '414734', 'last4': '3972', 'expiry': '02/2028', 'holder': 'Erica Lyn Langdon',
     'address': '1221 1st Ave Apt 1003', 'city': 'Seattle', 'state': 'WA', 'zip': '98101',
     'country': 'USA', 'phone': '3174102842', 'email': 'earl.lesperance867102@aol.com',
     'type': 'visa', 'level': 'classic', 'ip': '173.209.162.109',
     'notes': 'IP: 173.209.162.109 | 19230 46TH AVE S, SEATAC, WA 98188'},

    # TG26 | CA
    {'tg': 'TG26', 'bin': '414720', 'last4': '9796', 'expiry': '02/2028', 'holder': 'JENNIFER KLINE',
     'address': '1241 CEDAR OAK', 'city': 'Placerville', 'state': 'CA', 'zip': '95667',
     'country': 'USA', 'phone': '4352793446', 'email': 'jennifer.nickerson8674@aol.com',
     'type': 'visa', 'level': 'classic', 'ip': '73.15.233.84',
     'notes': 'IP: 73.15.233.84 | 829 FULTON AVE APT 1060, SACRAMENTO, CA 95825'},

    # TG27 | CT
    {'tg': 'TG27', 'bin': '438854', 'last4': '6161', 'expiry': '07/2028', 'holder': 'Janice Cannon',
     'address': '489a Heritage Village', 'city': 'Southbury', 'state': 'CT', 'zip': '06488',
     'country': 'USA', 'phone': '7036099277', 'email': 'leqobigalic587@gmail.com',
     'type': 'visa', 'level': 'signature', 'ip': '72.209.14.145',
     'notes': 'IP: 72.209.14.145 | 734 Orchard Street Apt#2, New Haven, CT 06511'},

    # TG28 | NE
    {'tg': 'TG28', 'bin': '409451', 'last4': '4922', 'expiry': '03/2028', 'holder': 'Matt Swinton',
     'address': '1101 Jackson St #203', 'city': 'Omaha', 'state': 'NE', 'zip': '68102',
     'country': 'USA', 'phone': '6198892757', 'email': 'moorecrystal185615@yahoo.com',
     'type': 'visa', 'level': 'classic', 'ip': '74.95.220.249',
     'notes': 'IP: 74.95.220.249 | 3905 Ida St, Omaha, NE 68112'},

    # TG29 | PA
    {'tg': 'TG29', 'bin': '442779', 'last4': '2426', 'expiry': '03/2027', 'holder': 'Wade Schaeffer',
     'address': '218 East Penn Avenue', 'city': 'Cleona', 'state': 'PA', 'zip': '17042',
     'country': 'USA', 'phone': '2088510438', 'email': 'wilcoxsarah490751@yahoo.com',
     'type': 'visa', 'level': 'classic', 'ip': '146.115.254.197',
     'notes': 'IP: 146.115.254.197 | 1103 W Somerville Ave, Philadelphia, PA 19141'},

    # TG30 | RI
    {'tg': 'TG30', 'bin': '552486', 'last4': '2334', 'expiry': '04/2028', 'holder': 'Tracy Glover',
     'address': '120 Bluff Ave', 'city': 'Cranston', 'state': 'RI', 'zip': '02905',
     'country': 'USA', 'phone': '2084063634', 'email': 'tricia_ahmed15229@yahoo.com',
     'type': 'mastercard', 'level': 'world', 'ip': '98.182.41.247',
     'notes': 'IP: 98.182.41.247 | 107 Mill St, Randolph MA, 02368'},

    # TG31 | NC
    {'tg': 'TG31', 'bin': '414720', 'last4': '2403', 'expiry': '07/2027', 'holder': 'Heather hastings',
     'address': '500 Hogans Valley Way', 'city': 'Cary', 'state': 'NC', 'zip': '27513',
     'country': 'USA', 'phone': '6057233352', 'email': 'hassan.nicole1991@aol.com',
     'type': 'visa', 'level': 'classic', 'ip': '75.177.167.230',
     'notes': 'IP: 75.177.167.230 | 1814 Fountain Dr # 1814, Raleigh, NC 27610'},

    # TG32 | WA
    {'tg': 'TG32', 'bin': '341169', 'last4': '1000', 'expiry': '04/2029', 'holder': 'Jennifer Pitts',
     'address': '6621 Charlotte Ave SE', 'city': 'Auburn', 'state': 'WA', 'zip': '98092',
     'country': 'USA', 'phone': '6104059229', 'email': 'tracynixon253778@yahoo.com',
     'type': 'amex', 'level': 'gold', 'ip': '173.209.162.109',
     'notes': 'IP: 173.209.162.109 | 1228 69Th Ave E, Fife, WA 98424'},

    # TG33 | VA
    {'tg': 'TG33', 'bin': '377246', 'last4': '9001', 'expiry': '04/2030', 'holder': 'Karin Ferguson',
     'address': '1641 Westhall Gardens Drive', 'city': 'N Chesterfield', 'state': 'VA', 'zip': '23235',
     'country': 'USA', 'phone': '5107983123', 'email': 'kearney_monique7656@aol.com',
     'type': 'amex', 'level': 'gold', 'ip': '72.83.153.33',
     'notes': 'IP: 72.83.153.33 | 17 BARNES CT | HAMPTON | 23664 | VA'},

    # TG34 | IL
    {'tg': 'TG34', 'bin': '414709', 'last4': '1804', 'expiry': '10/2029', 'holder': 'Lori Jelinek',
     'address': '2412 Sedwick Dr', 'city': 'Normal', 'state': 'IL', 'zip': '61761',
     'country': 'USA', 'phone': '6173081472', 'email': 'moorecrystal185615@yahoo.com',
     'type': 'visa', 'level': 'classic', 'ip': '72.26.187.247',
     'notes': 'IP: 72.26.187.247 | 678 WILLOW POND RD | RANTOUL | 61866 | IL'},

    # TG35 | TN
    {'tg': 'TG35', 'bin': '601101', 'last4': '7826', 'expiry': '04/2027', 'holder': 'Martin Reed Moncier',
     'address': '5311 Windingbrooke Lane', 'city': 'Knoxville', 'state': 'TN', 'zip': '37918',
     'country': 'USA', 'phone': '8056358444', 'email': 'foxbrian1434@aol.com',
     'type': 'discover', 'level': 'classic', 'ip': '107.197.232.237',
     'notes': 'IP: 107.197.232.237 | 3208 EASTERLAND ST | KNOXVILLE | 37917 | TN'},

    # TG36 | TX
    {'tg': 'TG36', 'bin': '414720', 'last4': '0119', 'expiry': '11/2029', 'holder': 'Jacqueline Phillips',
     'address': '13807 Sea Horse Ave', 'city': 'CORPUS CHRISTI', 'state': 'TX', 'zip': '78418',
     'country': 'USA', 'phone': '9084199049', 'email': 'joseph_tobin574965@aol.com',
     'type': 'visa', 'level': 'classic', 'ip': '216.228.71.178',
     'notes': 'IP: 216.228.71.178 | 550 W 22ND ST APT 10307 | GEORGETOWN | 78626 | TX'},

    # TG37 | MS
    {'tg': 'TG37', 'bin': '407887', 'last4': '5351', 'expiry': '05/2028', 'holder': 'Dominic Mickelson',
     'address': '2423 South Theodore Avenue', 'city': 'Sioux Falls', 'state': 'SD', 'zip': '57106',
     'country': 'USA', 'phone': '2128449883', 'email': 'denismurray1985@aol.com',
     'type': 'visa', 'level': 'classic', 'ip': '69.54.112.98',
     'notes': 'IP: 69.54.112.98 | 121 COLUMBIA AVE | JACKSON | 39209 | MS'},

    # TG38 | CO
    {'tg': 'TG38', 'bin': '601101', 'last4': '0498', 'expiry': '01/2028', 'holder': 'Susan Rainsberry',
     'address': '439 Agency Drive', 'city': 'MEEKER', 'state': 'CO', 'zip': '81641',
     'country': 'USA', 'phone': '4142545273', 'email': 'vogtkarla5711@yahoo.com',
     'type': 'discover', 'level': 'classic', 'ip': '69.170.193.152',
     'notes': 'IP: 69.170.193.152 | 420 PACIFIC AVE | FORT LUPTON | 80621 | CO'},

    # TG39 | NH
    {'tg': 'TG39', 'bin': '414740', 'last4': '4080', 'expiry': '12/2027', 'holder': 'Joanie A Samuelson',
     'address': '57 Sunset Rd', 'city': 'East Wakefield', 'state': 'NH', 'zip': '03830',
     'country': 'USA', 'phone': '5205590921', 'email': 'graf_jose1982@aol.com',
     'type': 'visa', 'level': 'classic', 'ip': '66.31.200.235',
     'notes': 'IP: 66.31.200.235 | 31 FORTIN DR | BROCKTON | 02302 | MA'},

    # TG40 | MD
    {'tg': 'TG40', 'bin': '555376', 'last4': '5096', 'expiry': '05/2027', 'holder': 'David W Donovan',
     'address': '415 Gun Road', 'city': 'Halethorpe', 'state': 'MD', 'zip': '21227',
     'country': 'USA', 'phone': '21070537362', 'email': 'zuromski.kara1994@aol.com',
     'type': 'mastercard', 'level': 'world', 'ip': '69.243.88.194',
     'notes': 'IP: 69.243.88.194 | 8612 MONMOUTH DR | UPPER MARLBORO | 20772 | MD'},

    # TG41 | PA
    {'tg': 'TG41', 'bin': '414718', 'last4': '8912', 'expiry': '01/2030', 'holder': 'Nancy A Gregg',
     'address': '130 Beechtree Dr', 'city': 'Broomall', 'state': 'PA', 'zip': '19008',
     'country': 'USA', 'phone': '9703661312', 'email': 'ruby.washington2001@aol.com',
     'type': 'visa', 'level': 'classic', 'ip': '146.115.254.197',
     'notes': 'IP: 146.115.254.197 | 2058 MAPLE AVE APT AH1-10 | HATFIELD | 19440 | PA'},

    # TG42 | PA
    {'tg': 'TG42', 'bin': '371381', 'last4': '9006', 'expiry': '09/2028', 'holder': 'charles h campbell',
     'address': '105 rossmore drive', 'city': 'malvern', 'state': 'PA', 'zip': '19355',
     'country': 'USA', 'phone': '7179892652', 'email': 'gravesquitta74837@yahoo.com',
     'type': 'amex', 'level': 'gold', 'ip': '173.49.190.88',
     'notes': 'IP: 173.49.190.88 | 208 Dock St Apt 214 | Schuylkill Haven | 17972 | PA'},

    # TG43 | FL
    {'tg': 'TG43', 'bin': '414709', 'last4': '0959', 'expiry': '04/2030', 'holder': 'John Pohlmann',
     'address': 'PO Box 203', 'city': 'Gulf Breeze', 'state': 'FL', 'zip': '32562',
     'country': 'USA', 'phone': '3344679181', 'email': 'graf_jose1982@aol.com',
     'type': 'visa', 'level': 'classic', 'ip': '70.167.235.177',
     'notes': 'IP: 70.167.235.177 | 314 W NINE ONE HALF MILE RD | PENSACOLA | 32534 | FL'},
]

ORDERS = [
    # TG1 Orders
    {'tg': 'TG1', 'shop': 'rotundatechtools.com', 'order_num': '18465', 'status': 'cancel', 'amount': 374.40, 'items': 'Square D QO120GFI x6'},
    {'tg': 'TG1', 'shop': 'furnacepartsource.com', 'order_num': '96125', 'status': 'refund', 'amount': 643.80, 'items': 'Resideo WT8840B1000 x3'},
    {'tg': 'TG1', 'shop': 'rotundatechtools.com', 'order_num': '000060907', 'status': 'pending', 'amount': 0},
    {'tg': 'TG1', 'shop': 'us.rs-online.com', 'order_num': '2561315859', 'status': 'declined', 'amount': 702.80, 'items': 'Square D QOU260 x7'},

    # TG2 Orders
    {'tg': 'TG2', 'shop': 'breakeroutlet.com', 'order_num': '42993', 'status': 'cancel', 'amount': 426.80, 'items': 'HOM2100 x8'},

    # TG3 Orders
    {'tg': 'TG3', 'shop': 'crescentelectric.com', 'order_num': 'S513977700', 'status': 'cancel', 'amount': 736.20, 'items': 'QO220CP x12'},
    {'tg': 'TG3', 'shop': 'northamericahvac.com', 'order_num': '294726', 'status': 'pending', 'amount': 668.69, 'items': 'TH6320ZW2003/U x4'},
    {'tg': 'TG3', 'shop': 'northamericahvac.com', 'order_num': '294801', 'status': 'pending', 'amount': 503.67, 'items': 'TH6320ZW2003/U x3'},

    # TG4 Orders
    {'tg': 'TG4', 'shop': 'furnacepartsource.com', 'order_num': '96107', 'status': 'shipped', 'amount': 606.50, 'items': 'TH4110U2005 x8', 'tracking': '1Z6544460345601189', 'carrier': 'UPS'},
    {'tg': 'TG4', 'shop': 'us.rs-online.com', 'order_num': '2561316225', 'status': 'pending', 'amount': 935.06, 'items': 'QO120GFI x7'},

    # TG5 Orders - DECLINE CARD shops
    {'tg': 'TG5', 'shop': 'livewiresupply.com', 'order_num': 'LWS-001', 'status': 'declined', 'amount': 0},
    {'tg': 'TG5', 'shop': 'northamericahvac.com', 'order_num': 'NAHVAC-001', 'status': 'declined', 'amount': 0},

    # TG6 Orders
    {'tg': 'TG6', 'shop': 'livewiresupply.com', 'order_num': '17025', 'status': 'cancel', 'amount': 517.44, 'items': 'TH6210U2001 x5'},

    # TG7 Orders
    {'tg': 'TG7', 'shop': 'ktool.net', 'order_num': '268363', 'status': 'cancel', 'amount': 542.41, 'items': 'TH4110U2005/U x10'},
    {'tg': 'TG7', 'shop': 'us.rs-online.com', 'order_num': 'RS-001', 'status': 'declined', 'amount': 0},

    # TG8 Orders
    {'tg': 'TG8', 'shop': 'tooldiscounter.com', 'order_num': 'TD-001', 'status': 'declined', 'amount': 0},

    # TG9 Orders
    {'tg': 'TG9', 'shop': 'hvacwholesaledirect.com', 'order_num': '17027', 'status': 'cancel', 'amount': 386.88, 'items': 'TH6210U2001 x4'},
    {'tg': 'TG9', 'shop': 'eztestpools.com', 'order_num': '182502', 'status': 'declined', 'amount': 471.66, 'items': 'Pentair 42001-0061S x3'},
    {'tg': 'TG9', 'shop': 'abesofmaine.com', 'order_num': 'AB1612974', 'status': 'cancel', 'amount': 395.00, 'items': 'Milwaukee 48-11-2450 x5'},
    {'tg': 'TG9', 'shop': 'furnacepartsource.com', 'order_num': '96142', 'status': 'refund', 'amount': 637.71, 'items': 'WT8840B1000 x3'},

    # TG10 Orders
    {'tg': 'TG10', 'shop': 'hvacwholesaledirect.com', 'order_num': '17028', 'status': 'cancel', 'amount': 490.49, 'items': 'TH6210U2001 x5'},
    {'tg': 'TG10', 'shop': 'brandnewtools.com', 'order_num': 'JDTENLEWK', 'status': 'cancel', 'amount': 379.00, 'items': 'Milwaukee 2839-20 x1'},
    {'tg': 'TG10', 'shop': 'poolsupplyexpress.com', 'order_num': '4664', 'status': 'cancel', 'amount': 467.70, 'items': 'Pentair 300-29X x2'},

    # TG11 Orders
    {'tg': 'TG11', 'shop': 'dale-electric.com', 'order_num': '20260322-3204F', 'status': 'pending', 'amount': 508.80, 'items': 'QO115CAFIC x8'},
    {'tg': 'TG11', 'shop': 'rotundatechtools.com', 'order_num': 'RTT-001', 'status': 'declined', 'amount': 0},
    {'tg': 'TG11', 'shop': 'northamericahvac.com', 'order_num': 'NAHVAC-002', 'status': 'declined', 'amount': 0},

    # TG12 Orders
    {'tg': 'TG12', 'shop': 'circuitbreakerwarehouse.com', 'order_num': '26636', 'status': 'cancel', 'amount': 816.00, 'items': 'QO220 x12'},
    {'tg': 'TG12', 'shop': 'us.rs-online.com', 'order_num': '2561313726', 'status': 'declined', 'amount': 0},
    {'tg': 'TG12', 'shop': 'northamericahvac.com', 'order_num': '294692', 'status': 'shipped', 'amount': 581.96, 'items': 'TH8321WF1001/U x3', 'tracking': '9434650899562151332588', 'carrier': 'USPS'},

    # TG13 Orders
    {'tg': 'TG13', 'shop': 'spwindustrial.com', 'order_num': 'SP-001', 'status': 'declined', 'amount': 0},
    {'tg': 'TG13', 'shop': 'superbreakers.com', 'order_num': '8LF4ZNG9K', 'status': 'cancel', 'amount': 419.76, 'items': 'HOM220 x24'},
    {'tg': 'TG13', 'shop': 'rotundatechtools.com', 'order_num': '000060909', 'status': 'pending', 'amount': 654.46, 'items': 'Fluke HVAC MULTIMETER x2'},

    # TG14 Orders
    {'tg': 'TG14', 'shop': 'spwindustrial.com', 'order_num': 'SP-002', 'status': 'declined', 'amount': 0},
    {'tg': 'TG14', 'shop': 'sylvane.com', 'order_num': 'J5KXIM908', 'status': 'cancel', 'amount': 609.87, 'items': 'TH9320WF5003 x3'},
    {'tg': 'TG14', 'shop': 'wholesalepoolequipment.com', 'order_num': '45767', 'status': 'pending', 'amount': 0},

    # TG15 Orders
    {'tg': 'TG15', 'shop': 'value-controls.com', 'order_num': 'VC-001', 'status': 'declined', 'amount': 0},

    # TG16 Orders
    {'tg': 'TG16', 'shop': 'value-controls.com', 'order_num': 'VC-002', 'status': 'declined', 'amount': 0},
    {'tg': 'TG16', 'shop': 'autoplicity.com', 'order_num': 'AUT-001', 'status': 'declined', 'amount': 0},

    # TG17 Orders
    {'tg': 'TG17', 'shop': 'value-controls.com', 'order_num': 'J5V5UYFW5', 'status': 'cancel', 'amount': 416.01, 'items': 'TH9320WF5003 x2'},
    {'tg': 'TG17', 'shop': 'autoplicity.com', 'order_num': 'AUT-002', 'status': 'declined', 'amount': 0},

    # TG18 Orders
    {'tg': 'TG18', 'shop': 'righttobeararmsnm.com', 'order_num': 'RTBA-001', 'status': 'declined', 'amount': 0},
    {'tg': 'TG18', 'shop': 'hvacwholesaledirect.com', 'order_num': '17037', 'status': 'cancel', 'amount': 628.88, 'items': 'TH9320WF5003 x2'},
    {'tg': 'TG18', 'shop': 'us.rs-online.com', 'order_num': '2561313843', 'status': 'shipped', 'amount': 310.00, 'items': 'Circuit Breaker 2P 20A x9', 'tracking': '1Z7539010394414481', 'carrier': 'UPS'},
    {'tg': 'TG18', 'shop': 'arbsession.com', 'order_num': '000313992', 'status': 'cancel', 'amount': 524.26, 'items': 'Milwaukee 2904-20 x2'},
    {'tg': 'TG18', 'shop': 'us.rs-online.com', 'order_num': '2561324847', 'status': 'pending', 'amount': 742.88, 'items': 'QOU260 x9'},

    # TG19 Orders
    {'tg': 'TG19', 'shop': 'murdochs.com', 'order_num': 'MUR-001', 'status': 'declined', 'amount': 0},
    {'tg': 'TG19', 'shop': 'northamericahvac.com', 'order_num': 'NAHVAC-003', 'status': 'declined', 'amount': 0},

    # TG20 Orders
    {'tg': 'TG20', 'shop': 'northamericahvac.com', 'order_num': '294622', 'status': 'shipped', 'amount': 459.35, 'items': 'TH9320WF5003 x2', 'tracking': '9434650899561149353512', 'carrier': 'USPS'},

    # TG21 Orders
    {'tg': 'TG21', 'shop': 'rotundatechtools.com', 'order_num': '000060836', 'status': 'shipped', 'amount': 564.66, 'items': 'FLU177 x1', 'tracking': '474237545027', 'carrier': 'FEDEX'},

    # TG22 Orders
    {'tg': 'TG22', 'shop': 'ballardindustrial.com', 'order_num': '6370', 'status': 'cancel', 'amount': 643.29, 'items': 'SAW SUPER SAWZALL 2904-20 x2'},

    # TG23 Orders
    {'tg': 'TG23', 'shop': 'constructiontoolwarehouse.com', 'order_num': 'CTW-001', 'status': 'declined', 'amount': 0},

    # TG24 Orders
    {'tg': 'TG24', 'shop': 'northamericahvac.com', 'order_num': '294650', 'status': 'shipped', 'amount': 614.85, 'items': 'TH9320WF5003 x3', 'tracking': '9434650899563154270372', 'carrier': 'USPS'},
    {'tg': 'TG24', 'shop': 'northamericahvac.com', 'order_num': 'NAHVAC-004', 'status': 'declined', 'amount': 0},

    # TG25 Orders
    {'tg': 'TG25', 'shop': 'furnacepartsource.com', 'order_num': '96118', 'status': 'refund', 'amount': 438.75, 'items': 'WT8840B1000 x2'},
    {'tg': 'TG25', 'shop': 'furnacepartsource.com', 'order_num': '96119', 'status': 'refund', 'amount': 438.75, 'items': 'WT8840B1000 x2'},

    # TG26 Orders
    {'tg': 'TG26', 'shop': 'woodworkingshop.com', 'order_num': '198994', 'status': 'cancel', 'amount': 537.08, 'items': 'Incra I-BOX x2'},
    {'tg': 'TG26', 'shop': 'trudoor.com', 'order_num': '588TEI647', 'status': 'cancel', 'amount': 508.64, 'items': 'DL2700IC-US26D x1'},
    {'tg': 'TG26', 'shop': 'justsaygolf.com', 'order_num': 'JSG-001', 'status': 'declined', 'amount': 0},

    # TG27 Orders
    {'tg': 'TG27', 'shop': 'grosselectric.com', 'order_num': 'O-5645239', 'status': 'declined', 'amount': 507.00, 'items': 'M18 Battery x3'},
    {'tg': 'TG27', 'shop': 'us.rs-online.com', 'order_num': '2561319168', 'status': 'declined', 'amount': 724.99, 'items': 'Circuit Breaker 2P 30A x7'},

    # TG28 Orders
    {'tg': 'TG28', 'shop': 'cpowertools.com', 'order_num': 'CPO-001', 'status': 'declined', 'amount': 0},

    # TG29 Orders
    {'tg': 'TG29', 'shop': 'cpowertools.com', 'order_num': 'W104601199', 'status': 'cancel', 'amount': 454.71, 'items': 'XPH15ZB x3'},

    # TG31 Orders
    {'tg': 'TG31', 'shop': 'hamradio.com', 'order_num': 'W7-1594634', 'status': 'pending', 'amount': 989.95, 'items': 'ICOM IC-7300 x1'},

    # TG32 Orders
    {'tg': 'TG32', 'shop': 'furnacepartsource.com', 'order_num': 'FPS-001', 'status': 'declined', 'amount': 0},

    # TG33 Orders
    {'tg': 'TG33', 'shop': 'unknown', 'order_num': 'UNK-001', 'status': 'declined', 'amount': 0},

    # TG34 Orders
    {'tg': 'TG34', 'shop': 'northamericahvac.com', 'order_num': '294757', 'status': 'refund', 'amount': 531.00, 'items': 'TH6320WF2003 x4'},
    {'tg': 'TG34', 'shop': 'us.rs-online.com', 'order_num': '2561319411', 'status': 'declined', 'amount': 584.89, 'items': 'FLUKE-374 FC x1'},

    # TG35 Orders
    {'tg': 'TG35', 'shop': 'rotundatechtools.com', 'order_num': '000060960', 'status': 'pending', 'amount': 0},

    # TG36 Orders
    {'tg': 'TG36', 'shop': 'hvacwholesaledirect.com', 'order_num': '17073', 'status': 'cancel', 'amount': 556.68, 'items': 'TH6210U2001 x6'},
    {'tg': 'TG36', 'shop': 'us.rs-online.com', 'order_num': '2561319546', 'status': 'shipped', 'amount': 801.48, 'items': 'QO120GFI x6', 'tracking': '1Z7539010394463697', 'carrier': 'UPS'},

    # TG37 Orders
    {'tg': 'TG37', 'shop': 'unknown', 'order_num': 'UNK-002', 'status': 'declined', 'amount': 0},

    # TG38 Orders
    {'tg': 'TG38', 'shop': 'us.rs-online.com', 'order_num': '2561323428', 'status': 'pending', 'amount': 584.89, 'items': 'FLUKE-374 FC x1'},

    # TG39 Orders
    {'tg': 'TG39', 'shop': 'unknown', 'order_num': 'UNK-003', 'status': 'declined', 'amount': 0},

    # TG40 Orders
    {'tg': 'TG40', 'shop': 'us.rs-online.com', 'order_num': '2561324190', 'status': 'shipped', 'amount': 584.89, 'items': 'FLUKE-374 FC x1', 'tracking': '480017028577', 'carrier': 'USPS'},
    {'tg': 'TG40', 'shop': 'cappusa.com', 'order_num': 'S3547141', 'status': 'pending', 'amount': 709.00, 'items': 'WT8840B1000 x3'},

    # TG41 Orders
    {'tg': 'TG41', 'shop': 'advancedsecurityllc.com', 'order_num': 'ASL-001', 'status': 'declined', 'amount': 0},
    {'tg': 'TG41', 'shop': 'qasupplies.com', 'order_num': 'QAS-001', 'status': 'declined', 'amount': 0},

    # TG42 Orders
    {'tg': 'TG42', 'shop': 'us.rs-online.com', 'order_num': '2561324898', 'status': 'pending', 'amount': 724.99, 'items': 'Circuit Breaker 2P 30A x7'},
]


def import_data():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    print("🚀 Starting VaultBase Test Data Import...")
    print("=" * 60)

    # 1. Import Shops
    print("\n📦 Importing Shops...")
    shop_map = {}
    for name, domain in SHOPS:
        cursor.execute("""
            INSERT OR IGNORE INTO shops (name, domain, created_at)
            VALUES (?, ?, datetime('now'))
        """, (name, domain))
        cursor.execute("SELECT id FROM shops WHERE domain = ?", (domain,))
        row = cursor.fetchone()
        if row:
            shop_map[domain] = row[0]
            print(f"  ✓ {name} ({domain})")

    print(f"\n  Total shops imported: {len(shop_map)}")

    # 2. Import Credit Cards
    print("\n💳 Importing Credit Cards...")
    card_map = {}  # tg -> card_id
    for card in CARDS:
        cursor.execute("""
            INSERT INTO credit_cards
            (bin, last4, expiry_date, holder_name, billing_address, city, state, zip, country,
             phone, email, card_type, card_level, status, source, notes, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        """, (
            card['bin'], card['last4'], card['expiry'], card['holder'],
            card['address'], card['city'], card['state'], card['zip'], card['country'],
            card['phone'], card['email'], card['type'], card['level'],
            'free', card['tg'], card['notes']
        ))
        card_id = cursor.lastrowid
        tg_key = f"{card['tg']}_{card['last4']}"
        card_map[tg_key] = card_id
        # Also map just TG for profile linking
        if card['tg'] not in card_map:
            card_map[card['tg']] = card_id
        print(f"  ✓ {card['tg']}: ****{card['last4']} ({card['holder']})")

    print(f"\n  Total cards imported: {len([k for k in card_map if '_' in k])}")

    # 3. Create Profiles for each TG
    print("\n👤 Creating Profiles...")
    profile_map = {}  # tg -> profile_id
    for card in CARDS:
        tg = card['tg']
        if tg not in profile_map:
            profile_id = f"{tg.lower()}-profile-{card['state'].lower()}"
            cursor.execute("""
                INSERT INTO profiles (id, card_id, notes, created_at, updated_at)
                VALUES (?, ?, ?, datetime('now'), datetime('now'))
            """, (profile_id, card_map[tg], f"{tg} Profile for {card['holder']}"))
            profile_map[tg] = profile_id
            print(f"  ✓ {tg} Profile -> {card['holder']}")

    print(f"\n  Total profiles created: {len(profile_map)}")

    # 4. Create Orders
    print("\n📋 Creating Orders...")
    order_count = 0
    for order in ORDERS:
        tg = order['tg']
        if tg not in profile_map:
            print(f"  ⚠ Skipping {order['order_num']} - TG {tg} not found")
            continue

        profile_id = profile_map[tg]
        shop_id = shop_map.get(order['shop'], 1)  # Default to first shop if not found

        cursor.execute("""
            INSERT INTO orders
            (profile_id, shop_id, order_number, status, total_amount, tracking_number, carrier, notes, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        """, (
            profile_id, shop_id, order['order_num'], order['status'],
            order.get('amount', 0), order.get('tracking'), order.get('carrier'),
            order.get('items', '')
        ))
        order_count += 1
        if order_count % 20 == 0:
            print(f"  ... {order_count} orders created")

    print(f"\n  Total orders created: {order_count}")

    # Commit and close
    conn.commit()
    conn.close()

    print("\n" + "=" * 60)
    print("✅ Import Complete!")
    print(f"\n📊 Summary:")
    print(f"   - Shops: {len(shop_map)}")
    print(f"   - Cards: {len([k for k in card_map if '_' in k])}")
    print(f"   - Profiles: {len(profile_map)}")
    print(f"   - Orders: {order_count}")
    print("\n🎉 You can now test all features including:")
    print("   - Cards page with filtering")
    print("   - Orders with tracking")
    print("   - Shop statistics")
    print("   - Dashboard analytics")
    print("   - IMAP integration (when emails arrive)")
    print("=" * 60)


if __name__ == '__main__':
    import_data()
