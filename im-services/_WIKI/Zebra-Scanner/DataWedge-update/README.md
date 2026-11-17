# DataWedge Update To  V6.8.50

[Zebra-Scanner Wiki](../README.md)  /  DataWedge-Update-To-V6.8.50

Update allows Zebra scanners to use keypress global listener on WMS input without having the soft keyboard appear. 
### Update Steps

###### 1. Check DataWedge version/functionality
- __Option 1 - Check Version:__
    * Open __DataWedge__
    * Click on "hamburger" menu (top right with 3 vertical dots)
    * Select __About__
    * If version < 6.8.50, need to be updated, continue to Step 2
    * If version >= 6.8.50, skip to Step 5

- __Option 2 - Check Functionality:__ 
    * Open __DataWedge__
    * Select __Profile0 (default)__
    * Scroll to __Keystroke output__ section
    * If this section does not have __Inter character delay__, device is not updated, continue to Step 2
    * If this section has __Inter character delay__, device is updated. Skip to Step 6

###### 2. Download the updated patch (or ask Sarit, he should have the microSD with the patch)
* Patch: [CFE_ATLAS_P07_NG_01-01.49.zip](https://drive.google.com/drive/folders/1XCe0B21gJUi7x96jGI_euprYub_VSIY9?usp=sharing)
* Transfer patch to the root folder of a microSD card

###### 3. Insert microSD card into Zebra Scanner
* Turn the Zebra Scanner off by long pressing the power button(top right) and select power off
* Open the back cover of the Zebra scanner
* Locate the microSD card slot and insert the microSD card

###### 4. Update the patch
* With the scanner on, hold the power button
* Select __reboot/reset__
    * Select __Yes/Ok__ when asked if want to restart/reboot device
* During reboot, hold down the PTT key on left side of device (top left button)
* When Zebra Technologies logo appear on screen, release the PTT key
    * NOTE: Use volume up/down to navigate up/down. power key to select
* Navigate to the __CFE_ATLAS_P07_NG_01-01.49.zip__
* Press the Power button to run the patch update
    * __NOTE: IF DEVICE IS UNABLE TO MOUNT MICROSD CARD, FOLLOW TROUBLESHOOT STEPS__
* Once update is done, Select __Reboot__ or __Power Off__

###### 5. Navigate to DataWedge Keystroke Output
* Open __DataWedge__
* Select default __Profile(0)__
* Scroll down to __Enable Keystroke Output__

###### 6. Update Keystroke Output to allow keypress listener
* Set __Inter character delay__ to 5ms
* DONE

### Troubleshooting
#### Scenario -  Device unable to mount microSD card
-  __Option 1__:
    * Remove microSD card from device
    * Clean microSD card holder with microfiber pad
    * Re-insert microSD card
- __Option 2__:
    * Purchase a different brand of microSD card

___
[Click here](../README.md) to return to the index.