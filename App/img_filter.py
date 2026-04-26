import cv2
import numpy as np

def edge_detection(image):
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    kernel = np.array([
        [0, -1, 0],
        [-1, 5, -1],
        [0, -1, 0]
    ])

    sharpen = cv2.filter2D(gray, -1, kernel)

    blur = cv2.GaussianBlur(sharpen, (3, 3), 0)

    edges = cv2.Laplacian(blur, ddepth=-1)

    return edges