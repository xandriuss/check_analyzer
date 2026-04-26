   
import cv2
import numpy as np


# kameros rodymas list: https://softron.zendesk.com/hc/en-us/articles/207695697-List-of-FourCC-codes-for-video-codecs
def vidstream():
    stream = cv2.VideoCapture(0)

    if not stream.isOpened():
        print("Failed to open camera")
        exit()


    while True:
        success, img = stream.read()

        
        if not success:
            print("Failed to capture image")
            break
       # fps = stream.get(cv2.CAP_PROP_FPS)
       # width = int(stream.get(4))
        #height = int(stream.get(3))
        #*'XVID'


        

        cv2.imshow("Camera Stream", img)

        if cv2.waitKey(1) & 0xFF == ord('q'):
            cv2.imwrite("assets/tests.png", img)
            print("picture saved")
            break
    

#fotkina
def photocapture():

     cam = cv2.VideoCapture(0)

     success, img = cam.read()

     if success:
      cv2.imwrite("assets/test.png", img)
      print("Image captured and saved as test.png")
     else:
           print("Failed to capture image")
     cam.release()
     cv2.destroyAllWindows()

#diagnostika
def diagnostic():

    for i in range(5):
        print(f"Testing camera index {i}...")

        cam = cv2.VideoCapture(i, cv2.CAP_DSHOW)

        if not cam.isOpened():
            print(f"❌ Camera {i} failed to open")
        continue

    ret, frame = cam.read()
    print(f"Opened: {cam.isOpened()}, Frame success: {ret}")

    
    
    cam.release()

vidstream()

